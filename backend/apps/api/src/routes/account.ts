import { parseSealingKeys, type GoogleDeps } from '@meetyou/auth';
import { scheduleAccountDeletion } from '@meetyou/queue';
import type { FastifyPluginAsync } from 'fastify';

import { UnauthorizedError } from '../errors.ts';
import { removeCalendarConnection, revokeRemovedCalendar } from './calendar.ts';
import { clearRefreshCookie, isWebClient } from '../web-session.ts';

/**
 * `POST /v1/account:delete` (FR-SET-03, DESIGN §15.3): records the request in the deletion audit
 * log and enqueues `account.delete` in the same transaction; the worker removes every meeting's
 * objects, the workspace and the user (refresh tokens cascade). 202: it completes asynchronously.
 */
export interface AccountRoutesOptions {
  /** ADR-0013: to revoke a connected Google Calendar when the account goes. */
  calendarTokenKeys?: string;
  googleDeps?: GoogleDeps;
}

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (fastify, options) => {
  const keys = parseSealingKeys(options.calendarTokenKeys);
  fastify.post(
    '/v1/account::delete',
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { workspaceId, userId } = request;
      if (!workspaceId || !userId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }
      const { requestId, calendar } = await request.inWorkspace(async (tx) => ({
        ...(await scheduleAccountDeletion(tx, { userId, workspaceId })),
        // The calendar grant is revoked now, not when the worker deletes the workspace.
        calendar: await removeCalendarConnection(tx, userId),
      }));
      await revokeRemovedCalendar(calendar, keys, options.googleDeps ?? {});
      // The web session ends here; its refresh token disappears with the user.
      if (isWebClient(request)) clearRefreshCookie(reply);
      return reply.status(202).send({ requestId });
    },
  );
};
