import type { FastifyPluginAsync } from 'fastify';
import { newUlid, ProductEventsRequest } from '@meetyou/contracts';

import { BadRequestError, UnauthorizedError } from '../errors.ts';

/** A client clock this far ahead is not trusted; the event is stamped with the server time. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/**
 * Product analytics (S4-15, PRD §19.6): `POST /v1/events` stores a small batch of typed events
 * (IDs, counts, durations and enums only; the schema rejects anything else). A user who opted out
 * gets 204 and nothing is stored, whatever the client sent.
 */
export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/v1/events',
    {
      preHandler: [
        fastify.requireAuth,
        fastify.rateLimit({ name: 'events', limit: 60, windowMs: 60_000, by: 'workspace' }),
      ],
      schema: {
        description: 'Record product analytics events (no content)',
        tags: ['analytics'],
        body: {
          type: 'object',
          required: ['client', 'events'],
          properties: {
            client: { type: 'string', enum: ['web', 'extension'] },
            events: { type: 'array', minItems: 1, maxItems: 25 },
          },
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const parsed = ProductEventsRequest.safeParse(request.body);
      if (!parsed.success) throw new BadRequestError('Invalid analytics events');
      const { client, events } = parsed.data;
      const now = Date.now();

      const stored = await inWorkspace(async (tx) => {
        const settings = await tx
          .selectFrom('userSettings')
          .select('analyticsOptOut')
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', userId)
          .executeTakeFirst();
        if (settings?.analyticsOptOut === true) return 0;
        await tx
          .insertInto('productEvents')
          .values(
            events.map((event) => {
              const at = Date.parse(event.at);
              return {
                id: `evt_${newUlid()}`,
                workspaceId,
                userId,
                client,
                name: event.name,
                props: JSON.stringify(event.props),
                occurredAt: new Date(at > now + FUTURE_SLACK_MS ? now : at),
              };
            }),
          )
          .execute();
        return events.length;
      });

      if (stored === 0) return reply.code(204).send();
      return reply.code(202).send({ accepted: stored });
    },
  );
};
