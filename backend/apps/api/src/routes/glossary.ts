import type { FastifyPluginAsync } from 'fastify';
import { newUlid, PutGlossaryRequest } from '@meetyou/contracts';
import { keytermsWithinBudget, MAX_KEYTERMS } from '@meetyou/providers';

import { AppError, BadRequestError, UnauthorizedError } from '../errors.ts';

/**
 * Glossary (S3-10, DESIGN §15.5, FR-SET-07): names and words the STT provider should listen for.
 * The gateway sends them as Deepgram `keyterm`s at the start of each session (S2-04). A list is
 * accepted only if it fits the provider's limits whole (capability from `@meetyou/providers`),
 * so no word is dropped silently.
 */
export const glossaryRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/glossary',
    { preHandler: fastify.requireAuth, schema: { tags: ['glossary'] } },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const rows = await inWorkspace((tx) =>
        tx.selectFrom('glossaryTerms').select('term').orderBy('createdAt').orderBy('id').execute(),
      );
      return reply.send({ terms: rows.map((r) => r.term), maxTerms: MAX_KEYTERMS });
    },
  );

  fastify.put(
    '/v1/glossary',
    { preHandler: fastify.requireAuth, schema: { tags: ['glossary'] } },
    async (request, reply) => {
      const { workspaceId, userId, inWorkspace } = request;
      if (!workspaceId || !userId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const body = PutGlossaryRequest.safeParse(request.body);
      if (!body.success) {
        throw new BadRequestError(
          `up to ${MAX_KEYTERMS} words of at most 100 characters, without commas`,
          'invalid_glossary',
        );
      }
      // Same word twice counts once; order is the user's.
      const seen = new Set<string>();
      const terms = body.data.terms.filter((t) => {
        const key = t.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (keytermsWithinBudget(terms).length < terms.length) {
        throw new AppError(
          422,
          'glossary_too_long',
          'these words do not all fit; remove some',
          false,
        );
      }
      await inWorkspace(async (tx) => {
        await tx.deleteFrom('glossaryTerms').execute();
        // `now()` is one value per transaction: explicit, increasing times keep the user's order.
        const base = Date.now();
        for (const [i, term] of terms.entries()) {
          await tx
            .insertInto('glossaryTerms')
            .values({
              id: `gls_${newUlid()}`,
              workspaceId,
              term,
              createdBy: userId,
              createdAt: new Date(base + i),
            })
            .execute();
        }
      });
      return reply.send({ terms, maxTerms: MAX_KEYTERMS });
    },
  );
};
