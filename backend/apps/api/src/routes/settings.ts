import type { FastifyPluginAsync } from 'fastify';
import {
  DEFAULT_USER_SETTINGS,
  PatchSettingsRequest,
  type UserSettings,
  newUlid,
} from '@meetyou/contracts';

import { BadRequestError, NotFoundError, UnauthorizedError } from '../errors.ts';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /v1/settings
  fastify.get(
    '/v1/settings',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Get workspace and user preferences',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              transcriptLanguageMode: { type: 'string' },
              summaryLanguage: { type: 'string' },
              hindiScript: { type: 'string' },
              retentionPolicy: { type: 'string' },
              recordVideo: { type: 'boolean' },
              videoQuality: { type: 'string' },
              consentMode: { type: 'string' },
              consentMessage: { type: 'string' },
              consentAcknowledgedAt: { type: ['string', 'null'] },
              followMeetMute: { type: 'boolean' },
              offerPrompt: { type: 'boolean' },
              defaultTemplate: { type: 'string' },
              analyticsOptOut: { type: 'boolean' },
            },
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

      const settings = await request.inWorkspace(async (tx) => {
        let row = await tx
          .selectFrom('userSettings')
          .selectAll()
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', userId)
          .executeTakeFirst();

        if (!row) {
          // If no row exists yet, initialize with defaults
          const inserted = await tx
            .insertInto('userSettings')
            .values({
              id: `set_${newUlid()}`,
              workspaceId,
              userId,
              ...DEFAULT_USER_SETTINGS,
              consentAcknowledgedAt: null,
            })
            .returningAll()
            .executeTakeFirst();
          row = inserted;
        }

        return row;
      });

      if (!settings) {
        throw new NotFoundError('Settings not found');
      }

      const response: UserSettings = {
        transcriptLanguageMode: settings.transcriptLanguageMode,
        summaryLanguage: settings.summaryLanguage,
        hindiScript: settings.hindiScript,
        retentionPolicy: settings.retentionPolicy,
        recordVideo: settings.recordVideo,
        videoQuality: settings.videoQuality,
        consentMode: settings.consentMode,
        consentMessage: settings.consentMessage ?? DEFAULT_USER_SETTINGS.consentMessage,
        consentAcknowledgedAt: settings.consentAcknowledgedAt
          ? new Date(settings.consentAcknowledgedAt).toISOString()
          : null,
        followMeetMute: settings.followMeetMute,
        offerPrompt: settings.offerPrompt,
        defaultTemplate: settings.defaultTemplate,
        analyticsOptOut: settings.analyticsOptOut,
      };

      return reply.send(response);
    },
  );

  // 2. PATCH /v1/settings
  fastify.patch(
    '/v1/settings',
    {
      preHandler: fastify.requireAuth,
      schema: {
        description: 'Update workspace and user preferences',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              transcriptLanguageMode: { type: 'string' },
              summaryLanguage: { type: 'string' },
              hindiScript: { type: 'string' },
              retentionPolicy: { type: 'string' },
              recordVideo: { type: 'boolean' },
              videoQuality: { type: 'string' },
              consentMode: { type: 'string' },
              consentMessage: { type: 'string' },
              consentAcknowledgedAt: { type: ['string', 'null'] },
              followMeetMute: { type: 'boolean' },
              offerPrompt: { type: 'boolean' },
              defaultTemplate: { type: 'string' },
              analyticsOptOut: { type: 'boolean' },
            },
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

      // PatchSettingsRequest: the client says `consentAcknowledged: true`; only the server sets the
      // time (FR-ONB-06), so a client cannot backdate or clear the acknowledgement.
      const parseResult = PatchSettingsRequest.safeParse(request.body);
      if (!parseResult.success) {
        throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Invalid settings body');
      }

      const updates = parseResult.data;
      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('No settings fields provided to update');
      }

      const updated = await request.inWorkspace(async (tx) => {
        // Prepare DB update values
        const updateValues: Record<string, unknown> = {};
        if (updates.transcriptLanguageMode !== undefined)
          updateValues.transcriptLanguageMode = updates.transcriptLanguageMode;
        if (updates.summaryLanguage !== undefined)
          updateValues.summaryLanguage = updates.summaryLanguage;
        if (updates.hindiScript !== undefined) updateValues.hindiScript = updates.hindiScript;
        if (updates.retentionPolicy !== undefined)
          updateValues.retentionPolicy = updates.retentionPolicy;
        if (updates.recordVideo !== undefined) updateValues.recordVideo = updates.recordVideo;
        if (updates.videoQuality !== undefined) updateValues.videoQuality = updates.videoQuality;
        if (updates.consentMode !== undefined) updateValues.consentMode = updates.consentMode;
        if (updates.consentMessage !== undefined)
          updateValues.consentMessage = updates.consentMessage;
        if (updates.consentAcknowledged === true) {
          updateValues.consentAcknowledgedAt = new Date();
        }
        if (updates.followMeetMute !== undefined)
          updateValues.followMeetMute = updates.followMeetMute;
        if (updates.offerPrompt !== undefined) updateValues.offerPrompt = updates.offerPrompt;
        if (updates.defaultTemplate !== undefined)
          updateValues.defaultTemplate = updates.defaultTemplate;
        if (updates.analyticsOptOut !== undefined)
          updateValues.analyticsOptOut = updates.analyticsOptOut;

        const row = await tx
          .updateTable('userSettings')
          .set(updateValues)
          .where('workspaceId', '=', workspaceId)
          .where('userId', '=', userId)
          .returningAll()
          .executeTakeFirst();

        return row;
      });

      if (!updated) {
        throw new NotFoundError('Settings record not found');
      }

      const response: UserSettings = {
        transcriptLanguageMode: updated.transcriptLanguageMode,
        summaryLanguage: updated.summaryLanguage,
        hindiScript: updated.hindiScript,
        retentionPolicy: updated.retentionPolicy,
        recordVideo: updated.recordVideo,
        videoQuality: updated.videoQuality,
        consentMode: updated.consentMode,
        consentMessage: updated.consentMessage ?? DEFAULT_USER_SETTINGS.consentMessage,
        consentAcknowledgedAt: updated.consentAcknowledgedAt
          ? new Date(updated.consentAcknowledgedAt).toISOString()
          : null,
        followMeetMute: updated.followMeetMute,
        offerPrompt: updated.offerPrompt,
        defaultTemplate: updated.defaultTemplate,
        analyticsOptOut: updated.analyticsOptOut,
      };

      return reply.send(response);
    },
  );
};
