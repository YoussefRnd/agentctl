import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sessions } from '@agentctl/core/db';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export const attachmentsRoutes: FastifyPluginAsync = (fastify) => {
  // Add binary content type parser for image mime types
  fastify.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: MAX_FILE_SIZE_BYTES },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // Upload attachment for session
  fastify.post<{
    Params: { sessionId: string };
  }>('/sessions/:sessionId/attachments', async (request, reply) => {
    const { sessionId } = request.params;

    if (!SAFE_ID_REGEX.test(sessionId)) {
      return reply.code(400).send({ error: 'Invalid session ID format' });
    }

    // Verify session exists
    const session = await fastify.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (!contentType || !ALLOWED_MIME_TYPES.has(contentType)) {
      return reply.code(415).send({
        error: `Unsupported Media Type: ${contentType ?? 'unknown'}. Allowed: image/png, image/jpeg, image/gif, image/webp`,
      });
    }

    const buffer = request.body as Buffer;
    if (!buffer || buffer.length === 0) {
      return reply.code(400).send({ error: 'Empty file payload' });
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return reply.code(413).send({ error: 'File exceeds 20 MB limit' });
    }

    const rawFilename = request.headers['x-filename'];
    let filename = 'image.png';
    if (typeof rawFilename === 'string') {
      try {
        filename = decodeURIComponent(rawFilename);
      } catch {
        filename = rawFilename;
      }
    }

    const attachmentId = crypto.randomUUID();
    const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);

    if (!fs.existsSync(sessionAttachmentsDir)) {
      fs.mkdirSync(sessionAttachmentsDir, { recursive: true });
    }

    const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);
    const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);

    const meta = {
      attachmentId,
      mimeType: contentType,
      filename,
      sizeBytes: buffer.length,
    };

    fs.writeFileSync(binPath, buffer);
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf8');

    return reply.code(201).send(meta);
  });

  // Fetch attachment binary/metadata
  fastify.get<{
    Params: { sessionId: string; attachmentId: string };
  }>('/sessions/:sessionId/attachments/:attachmentId', (request, reply) => {
    const { sessionId, attachmentId } = request.params;

    if (!SAFE_ID_REGEX.test(sessionId) || !SAFE_ID_REGEX.test(attachmentId)) {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }

    const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);

    const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);
    const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);

    if (!fs.existsSync(jsonPath) || !fs.existsSync(binPath)) {
      return reply.code(404).send({ error: 'Attachment not found' });
    }

    try {
      const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
        mimeType: string;
        filename: string;
      };
      const data = fs.readFileSync(binPath);

      reply.header('Content-Type', meta.mimeType || 'application/octet-stream');
      reply.header(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(meta.filename || 'attachment')}"`,
      );
      return reply.send(data);
    } catch {
      return reply.code(500).send({ error: 'Failed to read attachment' });
    }
  });

  return Promise.resolve();
};
