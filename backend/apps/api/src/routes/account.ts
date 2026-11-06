import { scheduleAccountDeletion } from '@meetyou/queue';
import type { FastifyPluginAsync } from 'fastify';

import { UnauthorizedError } from '../errors.ts';
import { clearRefreshCookie, isWebClient } from '../web-session.ts';

/**
 * `POST /v1/account:delete` (FR-SET-03, DESIGN §15.3): records the request in the deletion audit
 * log and enqueues `account.delete` in the same transaction; the worker removes every meeting's
 * objects, the workspace and the user (refresh tokens cascade). 202: it completes asynchronously.
 */
export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/v1/account::delete',
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const { workspaceId, userId } = request;
      if (!workspaceId || !userId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }
      const { requestId } = await request.inWorkspace((tx) =>
        scheduleAccountDeletion(tx, { userId, workspaceId }),
      );
      // The web session ends here; its refresh token disappears with the user.
      if (isWebClient(request)) clearRefreshCookie(reply);
      return reply.status(202).send({ requestId });
    },
  );
};
