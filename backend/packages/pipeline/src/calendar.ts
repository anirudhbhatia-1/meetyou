import {
  CalendarAccessRevokedError,
  refreshCalendarAccess,
  unseal,
  type SealingKey,
} from '@meetyou/auth';
import { newUlid } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import { CalendarHttpError, listCalendarEvents } from '@meetyou/providers';
import { DEFAULT_MAX_ATTEMPTS, defineTask, enqueue, jobKey } from '@meetyou/queue';
import { z } from 'zod';

/**
 * Google Calendar sync (ADR-0013). Each run polls one window of the user's primary calendar
 * (yesterday to three days ahead) and upserts what it finds; `synced_at` marks the events the
 * latest poll returned, so a moved or deleted event stops showing but keeps the notes written
 * for it until housekeeping. The job reschedules itself (15 min ± 25 % jitter, Google's advice
 * against fixed-interval polling); the API starts it again when Home finds the calendar stale.
 */
export const CALENDAR_SYNC = 'calendar.sync';
export const CalendarSyncPayload = z.object({
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
});
export const calendarSyncJob = {
  name: CALENDAR_SYNC,
  schema: CalendarSyncPayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;
export function calendarSyncJobKey(connectionId: string): string {
  return jobKey(CALENDAR_SYNC, connectionId, 1);
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_BEFORE_MS = DAY;
const WINDOW_AFTER_MS = 3 * DAY;
const EVERY_MS = 15 * 60 * 1000;
/** Ended events are kept this long (their notes went into the recording when it started). */
const KEEP_ENDED_MS = 14 * DAY;

export interface CalendarDeps {
  db: Db;
  /** The Google OAuth client; null when calendar sync is not configured. */
  google: { clientId: string; clientSecret: string } | null;
  sealingKeys: readonly SealingKey[];
  fetch?: typeof fetch;
  now?: () => Date;
  /** Queue the next run; off in tests without the queue schema. */
  schedule?: boolean;
  /** For tests: a fixed jitter in [-1, 1]. */
  jitter?: () => number;
}

const log = createLogger('pipeline');

export type SyncOutcome = 'synced' | 'needs_reconnect' | 'gone' | 'off';

export async function syncCalendar(
  deps: CalendarDeps,
  workspaceId: string,
  connectionId: string,
): Promise<SyncOutcome> {
  const google = deps.google;
  if (google === null || deps.sealingKeys.length === 0) return 'off';
  const now = (deps.now ?? (() => new Date()))();
  const connection = await deps.db.inWorkspace(workspaceId, (tx) =>
    tx
      .selectFrom('calendarConnections')
      .select(['id', 'status', 'refreshTokenSealed'])
      .where('id', '=', connectionId)
      .executeTakeFirst(),
  );
  if (connection === undefined) return 'gone';
  if (connection.status === 'needs_reconnect') return 'needs_reconnect';

  // Only the grant this run used: a reconnect during the run replaced it and stays active.
  const markReconnect = (code: string) =>
    deps.db.inWorkspace(workspaceId, (tx) =>
      tx
        .updateTable('calendarConnections')
        .set({ status: 'needs_reconnect', lastErrorCode: code })
        .where('id', '=', connectionId)
        .where('refreshTokenSealed', '=', connection.refreshTokenSealed)
        .execute(),
    );

  let refreshToken: string;
  try {
    refreshToken = unseal(connection.refreshTokenSealed, deps.sealingKeys, connectionId);
  } catch {
    // The key that sealed it is gone (rotated out): only a new consent helps.
    await markReconnect('key_missing');
    log.log('calendar.needs_reconnect', { connectionId, code: 'key_missing' });
    return 'needs_reconnect';
  }
  let accessToken: string;
  try {
    accessToken = await refreshCalendarAccess(refreshToken, google, {
      ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    });
  } catch (error) {
    if (error instanceof CalendarAccessRevokedError) {
      await markReconnect('revoked');
      log.log('calendar.needs_reconnect', { connectionId });
      return 'needs_reconnect';
    }
    throw error;
  }

  let events;
  try {
    events = await listCalendarEvents(
      accessToken,
      {
        timeMin: new Date(now.getTime() - WINDOW_BEFORE_MS),
        timeMax: new Date(now.getTime() + WINDOW_AFTER_MS),
      },
      { ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}) },
    );
  } catch (error) {
    // A fresh token that is refused means the grant no longer covers the calendar.
    if (error instanceof CalendarHttpError && error.status === 401) {
      await markReconnect('unauthorized');
      return 'needs_reconnect';
    }
    throw error; // 403/429/5xx: the queue retries with backoff
  }

  await deps.db.inWorkspace(workspaceId, async (tx) => {
    for (const e of events) {
      const values = {
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        meetCode: e.meetCode,
        attendees: JSON.stringify(e.attendees),
        syncedAt: now,
      };
      await tx
        .insertInto('calendarEvents')
        .values({
          id: `cev_${newUlid()}`,
          workspaceId,
          connectionId,
          externalId: e.externalId,
          ...values,
        })
        .onConflict((oc) => oc.columns(['connectionId', 'externalId']).doUpdateSet(values))
        .execute();
    }
    await tx
      .deleteFrom('calendarEvents')
      .where('connectionId', '=', connectionId)
      .where('endsAt', '<', new Date(now.getTime() - KEEP_ENDED_MS))
      .execute();
    await tx
      .updateTable('calendarConnections')
      .set({ lastSyncedAt: now, status: 'active', lastErrorCode: null })
      .where('id', '=', connectionId)
      .execute();
  });
  log.log('calendar.synced', { connectionId, count: events.length });
  return 'synced';
}

/** When the next run should start: 15 minutes, ± 25 %. */
export function nextSyncAt(now: Date, jitter: number): Date {
  const spread = Math.max(-1, Math.min(1, jitter)) * 0.25 * EVERY_MS;
  return new Date(now.getTime() + EVERY_MS + spread);
}

export function calendarSyncTask(deps: CalendarDeps) {
  return defineTask(CALENDAR_SYNC, CalendarSyncPayload, async ({ workspaceId, connectionId }) => {
    let outcome: SyncOutcome;
    try {
      outcome = await syncCalendar(deps, workspaceId, connectionId);
    } catch (error) {
      log.error('calendar.sync_failed', { connectionId, code: errorCode(error) });
      throw error;
    }
    if (outcome !== 'synced' || deps.schedule !== true) return;
    const now = (deps.now ?? (() => new Date()))();
    const jitter = (deps.jitter ?? (() => Math.random() * 2 - 1))();
    // [Verify] graphile-worker replace mode while this job still holds the key: the docs say a
    // locked job's key is moved to the new job, so the next run is scheduled, not merged.
    await deps.db.inWorkspace(workspaceId, (tx) =>
      enqueue(
        tx,
        calendarSyncJob,
        { workspaceId, connectionId },
        { jobKey: calendarSyncJobKey(connectionId), runAt: nextSyncAt(now, jitter) },
      ),
    );
  });
}
