import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  AuthError,
  exchangeCalendarCode,
  parseSealingKeys,
  revokeGoogleToken,
  seal,
  unseal,
  type GoogleDeps,
  type SealingKey,
} from '@meetyou/auth';
import {
  CALENDAR_SCOPE,
  type CalendarStatus,
  ConnectCalendarRequest,
  EventNotes,
  newUlid,
  type UpcomingMeeting,
} from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import { calendarSyncJob, calendarSyncJobKey } from '@meetyou/pipeline';
import { nameFromEmail } from '@meetyou/providers';
import { enqueue } from '@meetyou/queue';
import { sql } from 'kysely';

import type { ApiConfig } from '../config.ts';
import { AppError, BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

/**
 * Google Calendar (ADR-0013, DESIGN §10.1, §15.7): opt-in, read-only events, one calendar per
 * user. The web app runs the consent with PKCE and posts the code here; the refresh token is
 * sealed before it is stored and never leaves the backend. Without the OAuth client or the
 * sealing keys every route answers 503 `calendar_unavailable`.
 */
export interface CalendarRoutesOptions {
  config: Pick<
    ApiConfig,
    'googleClientId' | 'googleClientSecret' | 'calendarTokenKeys' | 'allowedRedirectUris'
  >;
  /** Tests replace Google's token endpoint and signing keys. */
  googleDeps?: GoogleDeps;
}

const DAY = 24 * 60 * 60 * 1000;
/** Home asks for a sync when the last one is older than this (the job also reschedules itself). */
const STALE_MS = 30 * 60 * 1000;
const MAX_UPCOMING_WINDOW_MS = 4 * DAY;

async function statusOf(tx: WorkspaceTx, userId: string): Promise<CalendarStatus> {
  const row = await tx
    .selectFrom('calendarConnections')
    .select(['accountEmail', 'status', 'lastSyncedAt'])
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row === undefined
    ? { connected: false, accountEmail: null, status: null, lastSyncedAt: null }
    : {
        connected: true,
        accountEmail: row.accountEmail,
        status: row.status,
        lastSyncedAt: row.lastSyncedAt === null ? null : new Date(row.lastSyncedAt).toISOString(),
      };
}

/** Deletes the user's connection (events and notes cascade) and returns what to revoke. */
export async function removeCalendarConnection(
  tx: WorkspaceTx,
  userId: string,
): Promise<{ id: string; refreshTokenSealed: string } | null> {
  const row = await tx
    .deleteFrom('calendarConnections')
    .where('userId', '=', userId)
    .returning(['id', 'refreshTokenSealed'])
    .executeTakeFirst();
  return row ?? null;
}

/** After the delete committed: revoke the grant at Google (best effort, never logged). */
export async function revokeRemovedCalendar(
  removed: { id: string; refreshTokenSealed: string } | null,
  keys: readonly SealingKey[],
  deps: Pick<GoogleDeps, 'fetch'>,
): Promise<void> {
  if (removed === null || keys.length === 0) return;
  try {
    // Revoking the refresh token removes every scope the user granted us.
    await revokeGoogleToken(unseal(removed.refreshTokenSealed, keys, removed.id), deps);
  } catch {
    // The row is gone either way; the grant lapses on its own if revoking fails.
  }
}

export const calendarRoutes: FastifyPluginAsync<CalendarRoutesOptions> = async (
  fastify,
  options,
) => {
  const { config } = options;
  const keys = parseSealingKeys(config.calendarTokenKeys);
  const google =
    config.googleClientId && config.googleClientSecret && keys.length > 0
      ? {
          clientId: config.googleClientId,
          clientSecret: config.googleClientSecret,
          allowedRedirectUris: config.allowedRedirectUris,
        }
      : null;
  const available = () => {
    if (google === null) {
      throw new AppError(503, 'calendar_unavailable', 'Calendar sync is not set up here.', false);
    }
    return google;
  };
  const who = (request: FastifyRequest) => {
    const { workspaceId, userId, inWorkspace } = request;
    if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
    return { workspaceId, userId, inWorkspace };
  };

  fastify.get(
    '/v1/calendar',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { userId, inWorkspace } = who(request);
      return reply.send(await inWorkspace((tx) => statusOf(tx, userId)));
    },
  );

  fastify.post(
    '/v1/calendar/connect',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = who(request);
      const client = available();
      const body = ConnectCalendarRequest.safeParse(request.body);
      if (!body.success)
        throw new BadRequestError('Invalid calendar connection', 'invalid_request');
      let grant;
      try {
        grant = await exchangeCalendarCode(
          { ...body.data, requiredScope: CALENDAR_SCOPE },
          client,
          options.googleDeps ?? {},
        );
      } catch (error) {
        if (error instanceof AuthError) {
          throw new AppError(
            error.code === 'scope_denied' ? 403 : 400,
            error.code === 'scope_denied' ? 'calendar_scope_denied' : 'calendar_connect_failed',
            'Couldn’t connect your calendar.',
            false,
          );
        }
        throw error;
      }
      const { replaced, status } = await inWorkspace(async (tx) => {
        // Serialized per user: a double submit must not race the one-calendar-per-user row.
        await sql`select pg_advisory_xact_lock(hashtext(${`calendar:${userId}`}))`.execute(tx);
        const existing = await tx
          .selectFrom('calendarConnections')
          .select(['id', 'refreshTokenSealed', 'accountEmail'])
          .where('userId', '=', userId)
          .executeTakeFirst();
        const id = existing?.id ?? `cal_${newUlid()}`;
        const accountEmail = grant.profile.email.slice(0, 320);
        const switched =
          existing !== undefined &&
          existing.accountEmail.toLowerCase() !== accountEmail.toLowerCase();
        const values = {
          accountEmail,
          refreshTokenSealed: seal(grant.refreshToken, keys, id),
          scope: grant.scope.slice(0, 2000),
          status: 'active' as const,
          lastErrorCode: null,
          // Another Google account: its events are not this one's.
          ...(switched ? { lastSyncedAt: null } : {}),
        };
        if (existing === undefined) {
          await tx
            .insertInto('calendarConnections')
            .values({ id, workspaceId, userId, ...values })
            .execute();
        } else {
          if (switched)
            await tx.deleteFrom('calendarEvents').where('connectionId', '=', id).execute();
          await tx.updateTable('calendarConnections').set(values).where('id', '=', id).execute();
        }
        // First sync now; it schedules the next ones itself.
        await enqueue(
          tx,
          calendarSyncJob,
          { workspaceId, connectionId: id },
          { jobKey: calendarSyncJobKey(id) },
        );
        // Revoking works on the whole grant (user + client): for the same account it would also
        // kill the token just issued, so only a switched account's old grant is revoked.
        let old: string | null = null;
        if (switched) {
          try {
            old = unseal(existing.refreshTokenSealed, keys, existing.id);
          } catch {
            old = null;
          }
        }
        return { replaced: old, status: await statusOf(tx, userId) };
      });
      if (replaced !== null) void revokeGoogleToken(replaced, options.googleDeps ?? {});
      return reply.send(status);
    },
  );

  fastify.delete(
    '/v1/calendar',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { userId, inWorkspace } = who(request);
      const removed = await inWorkspace((tx) => removeCalendarConnection(tx, userId));
      await revokeRemovedCalendar(removed, keys, options.googleDeps ?? {});
      return reply.status(204).send();
    },
  );

  fastify.get(
    '/v1/calendar/upcoming',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = who(request);
      const query = request.query as { from?: string; to?: string };
      const now = Date.now();
      const from = query.from !== undefined ? Date.parse(query.from) : now;
      const toRaw = query.to !== undefined ? Date.parse(query.to) : now + 2 * DAY;
      if (Number.isNaN(from) || Number.isNaN(toRaw) || toRaw <= from) {
        throw new BadRequestError('from and to must be times, from before to', 'invalid_window');
      }
      const to = Math.min(toRaw, from + MAX_UPCOMING_WINDOW_MS);
      const result = await inWorkspace(async (tx) => {
        const calendar = await statusOf(tx, userId);
        const connection = await tx
          .selectFrom('calendarConnections')
          .select(['id', 'status', 'lastSyncedAt'])
          .where('userId', '=', userId)
          .executeTakeFirst();
        if (connection === undefined) return { calendar, meetings: [] as UpcomingMeeting[] };
        const lastSync = connection.lastSyncedAt;
        if (
          google !== null &&
          connection.status === 'active' &&
          (lastSync === null || now - new Date(lastSync).getTime() > STALE_MS)
        ) {
          await enqueue(
            tx,
            calendarSyncJob,
            { workspaceId, connectionId: connection.id },
            { jobKey: calendarSyncJobKey(connection.id) },
          );
        }
        if (lastSync === null) return { calendar, meetings: [] as UpcomingMeeting[] };
        const rows = await tx
          .selectFrom('calendarEvents as e')
          .select((eb) => [
            'e.id',
            'e.title',
            'e.startsAt',
            'e.endsAt',
            'e.meetCode',
            'e.attendees',
            eb
              .selectFrom('calendarEventNotes as n')
              .select((x) => x.fn.countAll<string>().as('n'))
              .whereRef('n.eventId', '=', 'e.id')
              .as('noteCount'),
            eb
              .selectFrom('meetings as m')
              .select('m.id')
              .whereRef('m.calendarEventId', '=', 'e.id')
              .where('m.deletedAt', 'is', null)
              .orderBy('m.startedAt', 'desc')
              .limit(1)
              .as('meetingId'),
          ])
          .where('e.connectionId', '=', connection.id)
          .where('e.syncedAt', '>=', lastSync)
          .where('e.meetCode', 'is not', null)
          .where('e.endsAt', '>', new Date(from))
          .where('e.startsAt', '<', new Date(to))
          .orderBy('e.startsAt')
          .limit(50)
          .execute();
        const meetings: UpcomingMeeting[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          startsAt: new Date(r.startsAt).toISOString(),
          endsAt: new Date(r.endsAt).toISOString(),
          meetCode: r.meetCode,
          attendeeNames: r.attendees
            .filter((a) => !a.self)
            .map((a) => a.name ?? (a.email !== null ? nameFromEmail(a.email) : ''))
            .filter((n) => n !== ''),
          noteCount: Number(r.noteCount ?? 0),
          meetingId: r.meetingId ?? null,
        }));
        return { calendar, meetings };
      });
      return reply.send(result);
    },
  );

  /** The user's own event, or null (events of another user's calendar are never readable). */
  const ownEvent = (tx: WorkspaceTx, userId: string, id: string) =>
    tx
      .selectFrom('calendarEvents as e')
      .innerJoin('calendarConnections as c', 'c.id', 'e.connectionId')
      .select('e.id')
      .where('e.id', '=', id)
      .where('c.userId', '=', userId)
      .executeTakeFirst();

  fastify.get(
    '/v1/calendar/events/:id/notes',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { userId, inWorkspace } = who(request);
      const { id } = request.params as { id: string };
      const notes = await inWorkspace(async (tx) => {
        if ((await ownEvent(tx, userId, id)) === undefined) return null;
        const rows = await tx
          .selectFrom('calendarEventNotes')
          .select('text')
          .where('eventId', '=', id)
          .orderBy('order')
          .execute();
        return rows.map((r) => r.text);
      });
      if (notes === null) throw new NotFoundError('Event not found');
      return reply.send({ notes });
    },
  );

  fastify.put(
    '/v1/calendar/events/:id/notes',
    { preHandler: fastify.requireAuth, schema: { tags: ['calendar'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = who(request);
      const { id } = request.params as { id: string };
      const body = EventNotes.safeParse(request.body);
      if (!body.success)
        throw new BadRequestError('Up to 30 notes of 2000 characters', 'invalid_notes');
      const saved = await inWorkspace(async (tx) => {
        if ((await ownEvent(tx, userId, id)) === undefined) return null;
        await sql`select pg_advisory_xact_lock(hashtext(${`event-notes:${id}`}))`.execute(tx);
        await tx.deleteFrom('calendarEventNotes').where('eventId', '=', id).execute();
        for (const [order, text] of body.data.notes.entries()) {
          await tx
            .insertInto('calendarEventNotes')
            .values({ id: `cen_${newUlid()}`, workspaceId, eventId: id, text, order })
            .execute();
        }
        return body.data.notes;
      });
      if (saved === null) throw new NotFoundError('Event not found');
      return reply.send({ notes: saved });
    },
  );
};
