import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { sessions, type DbClient } from '@agentctl/core/db';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors/app-error.js';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
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

export class AttachmentService {
  constructor(
    private readonly db: DbClient,
    private readonly log: FastifyBaseLogger,
  ) {}
  async upload(
    sessionId: string,
    contentType: string | undefined,
    buffer: Buffer,
    rawFilename?: string,
  ) {
    if (!SAFE_ID_REGEX.test(sessionId)) {
      throw new AppError('Invalid session ID format', 400);
    }

    // Verify session exists
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (!contentType || !ALLOWED_MIME_TYPES.has(contentType)) {
      throw new AppError(
        `Unsupported Media Type: ${contentType ?? 'unknown'}. Allowed: image/png, image/jpeg, image/gif, image/webp`,
        415,
      );
    }

    if (!buffer || buffer.length === 0) {
      throw new AppError('Empty file payload', 400);
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new AppError('File exceeds 20 MB limit', 413);
    }

    if (!hasExpectedImageSignature(buffer, contentType)) {
      throw new AppError('File content does not match its declared image type', 400);
    }

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

    return meta;
  }
  async read(sessionId: string, attachmentId: string) {
    if (!SAFE_ID_REGEX.test(sessionId) || !SAFE_ID_REGEX.test(attachmentId))
      throw new AppError('Invalid ID format', 400);
    const directory = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
    if (!session) throw new AppError('Session not found', 404);
    try {
      const [rawMeta, data] = await Promise.all([
        fs.readFile(path.join(directory, `${attachmentId}.json`), 'utf8'),
        fs.readFile(path.join(directory, `${attachmentId}.bin`)),
      ]);
      const meta = JSON.parse(rawMeta) as { mimeType?: unknown; filename?: unknown };
      if (
        typeof meta.mimeType !== 'string' ||
        !ALLOWED_MIME_TYPES.has(meta.mimeType) ||
        typeof meta.filename !== 'string'
      )
        throw new Error('Invalid attachment metadata');
      return { mimeType: meta.mimeType, filename: meta.filename, data };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('Attachment not found', 404);
      this.log.error({ err: error, sessionId, attachmentId }, 'Failed to read attachment');
      throw new AppError('Failed to read attachment', 500);
    }
  }
}
