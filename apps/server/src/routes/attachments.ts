import type { FastifyPluginAsync } from 'fastify';
import { MAX_FILE_SIZE_BYTES } from '../services/attachment-service.js';

export const attachmentsRoutes: FastifyPluginAsync = (fastify) => {
  // Add binary content type parser for image mime types
  fastify.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: MAX_FILE_SIZE_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  fastify.post<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/attachments',
    async (request, reply) => {
      const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      const filename = request.headers['x-filename'];
      const meta = await fastify.services.attachments.upload(
        request.params.sessionId,
        contentType,
        request.body as Buffer,
        typeof filename === 'string' ? filename : undefined,
      );
      return reply.code(201).send(meta);
    },
  );
  fastify.get<{ Params: { sessionId: string; attachmentId: string } }>(
    '/sessions/:sessionId/attachments/:attachmentId',
    async (request, reply) => {
      const { sessionId, attachmentId } = request.params;
      const result = await fastify.services.attachments.read(sessionId, attachmentId);
      reply.header('Content-Type', result.mimeType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      );
      return reply.send(result.data);
    },
  );
  return Promise.resolve();
};
