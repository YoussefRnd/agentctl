import { z } from 'zod';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { AppError } from '../errors/app-error.js';
import { sessionModeSchema, approvalModeSchema } from '@agentctl/shared';


const createSessionSchema = z.object({
  projectId: z.uuid(),
  agent: z.string().min(1),
  taskSlug: z.string().min(1),
  mode: sessionModeSchema.optional(),
});

const updateSessionProviderSchema = z.object({
  selectedProvider: z.string().min(1),
  selectedModel: z.string().min(1),
  selectedThinkingEffort: z.enum(['low', 'medium', 'high']),
});

const sessionParamsSchema = z.object({
  id: z.uuid(),
});

export const sessionsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions',
    {
      schema: {
        body: createSessionSchema,
      },
    },
    async (request) => {
      try {
        return await fastify.sessionService.createSession({
          projectId: request.body.projectId,
          providerId: request.body.agent,
          taskSlug: request.body.taskSlug,
          mode: request.body.mode,
        });
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes('not found')) {
            throw new AppError(err.message, 404);
          }
          if (err.message.includes('not ready')) {
            throw new AppError(err.message, 400);
          }
        }
        throw err;
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      return await fastify.sessionService.getSessionWithCapabilities(request.params.id);
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/provider',
    {
      schema: {
        params: sessionParamsSchema,
        body: updateSessionProviderSchema,
      },
    },
    async (request) => {
      return await fastify.sessionService.updateSessionProvider(request.params.id, {
        selectedProvider: request.body.selectedProvider,
        selectedModel: request.body.selectedModel,
        selectedThinkingEffort: request.body.selectedThinkingEffort,
      });
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/branches',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      try {
        return await fastify.sessionService.listBranches(request.params.id);
      } catch (err) {
        throw new AppError(err instanceof Error ? err.message : 'Failed to list branches', 500);
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/branch',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({
          branch: z.string().min(1),
        }),
      },
    },
    async (request) => {
      try {
        return await fastify.sessionService.checkoutBranch(request.params.id, request.body.branch);
      } catch (err) {
        throw new AppError(err instanceof Error ? err.message : 'Failed to change branch', 500);
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/mode',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({ mode: sessionModeSchema }),
      },
    },
    async (request) => {
      try {
        return await fastify.sessionService.switchMode(request.params.id, request.body.mode);
      } catch (err) {
        request.log.error(err, 'Failed to switch session mode');
        throw new AppError(
          err instanceof Error ? err.message : 'Failed to switch session mode',
          500,
        );
      }
    },
    );

    fastify.withTypeProvider<ZodTypeProvider>().patch(
    '/sessions/:id/approval-mode',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({ approvalMode: approvalModeSchema }),
      },
    },
    async (request) => {
      return await fastify.sessionService.updateApprovalMode(request.params.id, request.body.approvalMode);
    },
    );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/merge',
    {
      schema: {
        params: sessionParamsSchema,
        body: z.object({
          commitMessage: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const { commitMessage } = request.body;
      return await fastify.sessionService.finalizeSession(id, 'merge', commitMessage);
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/discard',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      const { id } = request.params;
      return await fastify.sessionService.finalizeSession(id, 'discard');
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/sessions/:id',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      await fastify.sessionService.deleteSession(request.params.id);
      return { success: true };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/archive',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      await fastify.sessionService.archiveSession(request.params.id);
      return { success: true };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/restore',
    {
      schema: {
        params: sessionParamsSchema,
      },
    },
    async (request) => {
      await fastify.sessionService.restartSession(request.params.id);
      return { success: true };
    },
  );

  // Register raw body parser for standard image types to facilitate direct binary uploads.
  fastify.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    { parseAs: 'buffer' },
    (req, body, done) => {
      done(null, body);
    }
  );

  const attachmentParamsSchema = z.object({
    id: z.uuid(),
    attachmentId: z.uuid(),
  });

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/:id/attachments',
    {
      schema: {
        params: sessionParamsSchema,
      },
      bodyLimit: 20 * 1024 * 1024, // 20 MB limit
    },
    async (request) => {
      const sessionId = request.params.id;
      const buffer = request.body as Buffer;
      if (!Buffer.isBuffer(buffer)) {
        throw new AppError('Expected raw binary body', 400);
      }

      const mimeType = request.headers['content-type'] ?? 'application/octet-stream';
      const rawFilename = request.headers['x-filename'] as string;
      const filename = rawFilename ? decodeURIComponent(rawFilename) : 'attachment';

      const attachmentId = crypto.randomUUID();

      const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
      await fs.promises.mkdir(sessionAttachmentsDir, { recursive: true });

      const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);
      const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);

      const meta = {
        attachmentId,
        mimeType,
        filename,
        sizeBytes: buffer.length,
      };

      await fs.promises.writeFile(binPath, buffer);
      await fs.promises.writeFile(jsonPath, JSON.stringify(meta), 'utf8');

      return meta;
    }
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/sessions/:id/attachments/:attachmentId',
    {
      schema: {
        params: attachmentParamsSchema,
      },
    },
    async (request, reply) => {
      const { id: sessionId, attachmentId } = request.params;
      const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', sessionId);
      const binPath = path.join(sessionAttachmentsDir, `${attachmentId}.bin`);
      const jsonPath = path.join(sessionAttachmentsDir, `${attachmentId}.json`);

      if (!fs.existsSync(binPath) || !fs.existsSync(jsonPath)) {
        throw new AppError('Attachment not found', 404);
      }

      try {
        const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { mimeType: string };
        const fileBuffer = fs.readFileSync(binPath);
        reply.type(meta.mimeType);
        return fileBuffer;
      } catch {
        throw new AppError('Failed to read attachment', 500);
      }
    }
  );

  done();
};

