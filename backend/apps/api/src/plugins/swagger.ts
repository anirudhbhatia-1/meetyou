import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

export interface SwaggerPluginOptions {
  enabled?: boolean;
}

const swaggerPluginAsync: FastifyPluginAsync<SwaggerPluginOptions> = async (fastify, options) => {
  if (options.enabled === false) return;

  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MeetYou REST API',
        description:
          'REST API for MeetYou (meetings, notes, transcripts, settings, and sessions). ARCHITECTURE §12.',
        version: '0.1.0',
      },
      servers: [
        {
          url: '/',
          description: 'Current environment',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT Access Token with wsid and user claims (ADR-0004 §4.2).',
          },
        },
      },
      tags: [
        { name: 'health', description: 'Liveness, readiness, and service diagnostics' },
        { name: 'auth', description: 'Google authentication and token lifecycle' },
        { name: 'meetings', description: 'Meeting metadata, states, and participant info' },
        { name: 'sessions', description: 'Realtime gateway recording sessions' },
        { name: 'notes', description: 'Anchor notes and scratchpad entries' },
        { name: 'settings', description: 'User retention, language, and consent preferences' },
      ],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });

  // Dedicated raw OpenAPI JSON schema endpoint
  fastify.get('/openapi.json', {
    schema: {
      hide: true,
    },
    handler: async (_request, reply) => {
      reply.header('content-type', 'application/json');
      return fastify.swagger();
    },
  });
};

export const swaggerPlugin = fp(swaggerPluginAsync, {
  name: 'swagger-plugin',
  fastify: '5.x',
});
