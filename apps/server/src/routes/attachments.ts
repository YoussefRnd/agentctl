import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sessions } from '@agentctl/core/db';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function hasExpectedImageSignature(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/gif': {
      const signature = buffer.subarray(0, 6).toString('ascii');
      return signature === 'GIF87a' || signature === 'GIF89a';
    }
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    default:
      return false;
  }
}

function sanitizeFilename(rawFilename: string | undefined): string {
  if (!rawFilename) return 'image';

  let decoded = rawFilename;
  try {
    decoded = decodeURIComponent(rawFilename);
  } catch {
    // Keep the original value if it is not valid URI-encoded text.
  }

  const filename = Array.from(path.basename(decoded.replaceAll('\\', '/')))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint != null && codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .slice(0, 255);
  return filename || 'image';
}

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

    if (!hasExpectedImageSignature(buffer, contentType)) {
      return reply.code(400).send({ error: 'File content does not match its declared image type' });
    }

    const rawFilename = request.headers['x-filename'];
    const filename = sanitizeFilename(typeof rawFilename === 'string' ? rawFilename : undefined);
    const attachmentId = crypto.randomUUID();
    const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);

    const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);
    const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);

    const meta = {
      attachmentId,
      mimeType: contentType,
      filename,
      sizeBytes: buffer.length,
    };

    await fs.mkdir(sessionAttachmentsDir, { recursive: true });
    try {
      await fs.writeFile(binPath, buffer);
      await fs.writeFile(jsonPath, JSON.stringify(meta), 'utf8');
    } catch (error) {
      await Promise.allSettled([fs.rm(binPath, { force: true }), fs.rm(jsonPath, { force: true })]);
      throw error;
    }

    return reply.code(201).send(meta);
  });

  // Fetch attachment binary/metadata
  fastify.get<{
    Params: { sessionId: string; attachmentId: string };
  }>('/sessions/:sessionId/attachments/:attachmentId', async (request, reply) => {
    const { sessionId, attachmentId } = request.params;

    if (!SAFE_ID_REGEX.test(sessionId) || !SAFE_ID_REGEX.test(attachmentId)) {
      return reply.code(400).send({ error: 'Invalid ID format' });
    }

    const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);

    const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);
    const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);

    const session = await fastify.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    try {
      const [rawMeta, data] = await Promise.all([
        fs.readFile(jsonPath, 'utf8'),
        fs.readFile(binPath),
      ]);
      const meta = JSON.parse(rawMeta) as {
        mimeType?: unknown;
        filename?: unknown;
      };

      if (
        typeof meta.mimeType !== 'string' ||
        !ALLOWED_MIME_TYPES.has(meta.mimeType) ||
        typeof meta.filename !== 'string'
      ) {
        throw new Error('Invalid attachment metadata');
      }

      reply.header('Content-Type', meta.mimeType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      );
      return reply.send(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.code(404).send({ error: 'Attachment not found' });
      }
      fastify.log.error({ err: error, sessionId, attachmentId }, 'Failed to read attachment');
      return reply.code(500).send({ error: 'Failed to read attachment' });
    }
  });

  return Promise.resolve();
};
