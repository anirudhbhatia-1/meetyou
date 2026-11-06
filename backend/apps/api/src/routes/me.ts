import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import type { MeResponse } from '@meetyou/contracts';

import { NotFoundError, UnauthorizedError } from '../errors.ts';

export const meRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/me',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get current authenticated user profile and active workspace',
        tags: ['user'],
        response: {
          200: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              workspaceId: { type: 'string' },
              email: { type: 'string' },
              displayName: { type: 'string' },
            },
            required: ['userId', 'workspaceId', 'email', 'displayName'],
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const workspaceId = request.workspaceId;
      if (!userId || !workspaceId || !request.inWorkspace) {
        throw new UnauthorizedError('Unauthorized');
      }

      const result = await request.inWorkspace(async (tx) => {
        // Set app.user_id to satisfy own_user RLS policy on the users table (ARCHITECTURE §11)
        await sql`select set_config('app.user_id', ${userId}, true)`.execute(tx);

        const user = await tx
          .selectFrom('users')
          .select(['id', 'email', 'displayName'])
          .where('id', '=', userId)
          .executeTakeFirst();

        const workspace = await tx
          .selectFrom('workspaces')
          .select(['id', 'name', 'plan'])
          .where('id', '=', workspaceId)
          .executeTakeFirst();

        const membership = await tx
          .selectFrom('memberships')
          .select(['role'])
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', userId)
          .executeTakeFirst();

        return { user, workspace, membership };
      });

      if (!result.user || !result.workspace) {
        throw new NotFoundError('User or workspace not found');
      }

      const response: MeResponse = {
        userId: result.user.id,
        workspaceId: result.workspace.id,
        email: result.user.email,
        displayName: result.user.displayName,
      };

      return reply.send(response);
    },
  );
};
