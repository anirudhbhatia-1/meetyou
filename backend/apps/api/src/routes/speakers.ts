import type { FastifyPluginAsync } from 'fastify';
import { newUlid, RenameSpeakerRequest } from '@meetyou/contracts';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

/**
 * Speaker rename (S4-09, DESIGN §12.5, FR-SPK-05): names a diarized cluster for the whole meeting,
 * either as one of the meeting's participants or as a new name the user typed (stored as a
 * `user_edit` participant). Labels only — never a voiceprint (FR-SPK-06). Rewritten notes pick the
 * name up; owners already assigned keep pointing at the participant.
 */
export const speakersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.patch(
    '/v1/meetings/:id/speakers/:clusterId',
    {
      preHandler: fastify.requireAuth,
      schema: {
        tags: ['meetings'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' }, clusterId: { type: 'string' } },
          required: ['id', 'clusterId'],
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, inWorkspace } = request;
      if (!workspaceId || !inWorkspace) throw new UnauthorizedError('Unauthorized');
      const { id: meetingId, clusterId } = request.params as { id: string; clusterId: string };
      const body = RenameSpeakerRequest.safeParse(request.body);
      if (!body.success)
        throw new BadRequestError('a participant or a name is required', 'invalid_speaker');
      const result = await inWorkspace(async (tx) => {
        const cluster = await tx
          .selectFrom('speakerClusters as c')
          .innerJoin('meetings as m', 'm.id', 'c.meetingId')
          .select(['c.id'])
          .where('c.id', '=', clusterId)
          .where('c.meetingId', '=', meetingId)
          .where('m.deletedAt', 'is', null)
          .executeTakeFirst();
        if (cluster === undefined) return null;
        let participant: { id: string; displayName: string } | undefined;
        if ('participantId' in body.data) {
          participant = await tx
            .selectFrom('participants')
            .select(['id', 'displayName'])
            .where('id', '=', body.data.participantId)
            .where('meetingId', '=', meetingId)
            .executeTakeFirst();
          if (participant === undefined) {
            throw new BadRequestError('not a participant of this meeting', 'invalid_participant');
          }
        } else {
          const name = body.data.name;
          // The same typed name twice is one person.
          participant =
            (await tx
              .selectFrom('participants')
              .select(['id', 'displayName'])
              .where('meetingId', '=', meetingId)
              .where('isSelf', '=', false)
              .where('displayName', '=', name)
              .executeTakeFirst()) ??
            (await tx
              .insertInto('participants')
              .values({
                id: `prt_${newUlid()}`,
                workspaceId,
                meetingId,
                displayName: name,
                source: 'user_edit',
              })
              .returning(['id', 'displayName'])
              .executeTakeFirstOrThrow());
        }
        await tx
          .updateTable('speakerClusters')
          .set({ participantId: participant.id })
          .where('id', '=', clusterId)
          .execute();
        return { clusterId, participantId: participant.id, displayName: participant.displayName };
      });
      if (result === null) throw new NotFoundError('speaker not found');
      return reply.send(result);
    },
  );
};
