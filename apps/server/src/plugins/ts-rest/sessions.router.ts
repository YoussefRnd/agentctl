import { createCodeReviewRouter } from './code-review.router.js';
import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { sessionsContract, providerCapabilitySchema, createTaskSlug } from '@agentctl/shared';
import { createSessionGitRouter } from './session-git.router.js';
import { createSessionRepositoryRouter } from './session-repository.router.js';
import {
  publishSessionChange,
  publishWorkspaceChange,
} from '../../services/session-state-events.js';

/** Compose domain handlers while preserving the existing session route contract. */
export function createSessionsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof sessionsContract> {
  return {
    ...createSessionGitRouter(fastify),
    ...createCodeReviewRouter(fastify),
    ...createSessionRepositoryRouter(fastify),
    resumeSessionQueue: async ({ params }) => {
      try {
        await fastify.sessionManager.resumeSessionQueue(params.id);
        publishSessionChange(fastify.eventBus, params.id);
        return { status: 200 as const, body: { success: true as const } };
      } catch (error) {
        return {
          status: 409 as const,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    getSessionExecution: async ({ params }) => ({
      status: 200 as const,
      body: fastify.sessionService.getExecution(params.id),
    }),
    changeQueuedMessage: async ({ params, body }) => {
      try {
        await fastify.sessionManager.changeQueuedMessage(
          params.id,
          params.commandId,
          body.action,
          body.action === 'edit' ? body.input : undefined,
        );
        publishSessionChange(fastify.eventBus, params.id);
        return { status: 200 as const, body: { success: true as const } };
      } catch (error) {
        return {
          status: 409 as const,
          body: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
    importNativeSession: async ({ body }) => {
      const result = await fastify.sessionService.importNativeSession(body);
      publishSessionChange(fastify.eventBus, result.sessionId);
      return { status: 200 as const, body: result };
    },
    getSessions: async () => {
      return { status: 200 as const, body: await fastify.sessionService.getSessions() };
    },
    createSession: async ({ body }) => {
      const session = await fastify.sessionService.createSession({
        projectId: body.projectId,
        providerId: body.agent,
        taskSlug: createTaskSlug(body.taskSlug),
        mode: body.mode,
        selectedModel: body.selectedModel,
        selectedThinkingEffort: body.selectedThinkingEffort,
        approvalMode: body.approvalMode,
        agentPersona: body.agentPersona,
      });
      publishSessionChange(fastify.eventBus, session.id);
      return {
        status: 201 as const,
        body: session,
      };
    },
    getSessionById: async ({ params }) => {
      const { id } = params;
      const result = await fastify.sessionService.getSessionWithCapabilities(id);
      return {
        status: 200 as const,
        body: {
          session: result.session,
          capabilities: result.capabilities.map((c) => providerCapabilitySchema.parse(c)),
        },
      };
    },
    sendTerminalInput: ({ params, body }) => {
      const { id, terminalId } = params;
      const { data } = body;
      const success = fastify.sessionService.writeTerminalInput(id, terminalId, data);
      return Promise.resolve({
        status: 200 as const,
        body: { success },
      });
    },
    mergeSession: async ({ params, body }) => {
      const { id } = params;
      const { commitMessage, targetBranch } = body;
      try {
        await fastify.sessionService.finalizeSession(id, 'merge', commitMessage, targetBranch);
        publishWorkspaceChange(fastify.eventBus, id);
        return {
          status: 200 as const,
          body: { success: true },
        };
      } catch (err) {
        publishWorkspaceChange(fastify.eventBus, id);
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    discardSession: async ({ params }) => {
      const { id } = params;
      try {
        await fastify.sessionService.finalizeSession(id, 'discard');
        publishWorkspaceChange(fastify.eventBus, id);
        return {
          status: 200 as const,
          body: { success: true },
        };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    patchSession: async ({ params, body }) => {
      const { id } = params;
      const result = await fastify.sessionService.patchSession(id, body);
      if (body.branch !== undefined || body.mode !== undefined) {
        publishWorkspaceChange(fastify.eventBus, id);
      } else {
        publishSessionChange(fastify.eventBus, id);
      }
      return {
        status: 200 as const,
        body: {
          session: result.session,
          capabilities: result.capabilities.map((c) => providerCapabilitySchema.parse(c)),
        },
      };
    },
    deleteSession: async ({ params }) => {
      const { id } = params;
      fastify.services.cancelReviewChecksForSession(id);
      await fastify.sessionService.deleteSession(id);
      publishSessionChange(fastify.eventBus, id);
      return {
        status: 204 as const,
        body: undefined,
      };
    },
    archiveSession: async ({ params }) => {
      const { id } = params;
      fastify.services.cancelReviewChecksForSession(id);
      await fastify.sessionService.archiveSession(id);
      publishSessionChange(fastify.eventBus, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    restoreSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.restartSession(id);
      publishSessionChange(fastify.eventBus, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    undoDiscard: async ({ params }) => {
      try {
        await fastify.sessionManager.undoDiscard(params.id);
        publishWorkspaceChange(fastify.eventBus, params.id);
        return { status: 200 as const, body: { success: true } };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    rewindSession: async ({ params, body }) => {
      const { id } = params;
      const { eventId, mode } = body;
      const result = await fastify.sessionService.rewindSession(id, eventId, mode);
      publishWorkspaceChange(fastify.eventBus, result.forkSessionId ?? id);
      return {
        status: 200 as const,
        body: {
          success: true,
          forkSessionId: result.forkSessionId ?? undefined,
          undoSnapshotHash: result.undoSnapshotHash ?? undefined,
          restoredFiles: result.restoredFiles ?? undefined,
        },
      };
    },
    undoRewind: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.undoRewind(id);
      publishWorkspaceChange(fastify.eventBus, id);
      return {
        status: 200 as const,
        body: {
          success: true,
        },
      };
    },
    handoffSession: async ({ params, body }) => {
      const { id } = params;
      const { targetProvider, targetModel, nextSessionFocus } = body;
      const result = await fastify.sessionService.handoffSession(
        id,
        targetProvider,
        targetModel,
        nextSessionFocus,
      );
      publishSessionChange(fastify.eventBus, result.sessionId);
      return {
        status: 200 as const,
        body: {
          sessionId: result.sessionId,
          handoffFilePath: result.handoffFilePath,
          initialPrompt: result.initialPrompt,
          handoffSource: result.handoffSource,
        },
      };
    },
    restoreSnapshot: async ({ params, body }) => {
      const { id } = params;
      const { snapshotHash } = body;
      const result = await fastify.sessionService.restoreSnapshot(id, snapshotHash);
      publishWorkspaceChange(fastify.eventBus, id);
      return {
        status: 200 as const,
        body: {
          success: true,
          backupHash: result.backupHash,
        },
      };
    },
    previewSnapshotDiff: async ({ params }) => {
      const { id, eventId } = params;
      const result = await fastify.sessionService.previewSnapshotDiff(id, eventId);
      return {
        status: 200 as const,
        body: result,
      };
    },
    spawnParallelAgent: async ({ params, body }) => {
      const { id } = params;
      const session = await fastify.sessionService.spawnParallelAgent(id, body);
      publishSessionChange(fastify.eventBus, session.id);
      return {
        status: 201 as const,
        body: { session },
      };
    },
    cancelSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionManager.handleClientMessage(id, 'cancel', {});
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    approveEvent: async ({ params, body }) => {
      const { id } = params;
      const { eventId, optionId } = body;
      await fastify.sessionManager.handleClientMessage(id, 'approve', { eventId, optionId });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    denyEvent: async ({ params, body }) => {
      const { id } = params;
      const { eventId } = body;
      await fastify.sessionManager.handleClientMessage(id, 'deny', { eventId });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    sendInput: async ({ params, body }) => {
      const { id } = params;
      const { input, attachmentIds, clientMessageId } = body;
      try {
        const eventId = await fastify.sessionManager.startInput(
          id,
          input,
          attachmentIds,
          ...(clientMessageId ? [clientMessageId] : []),
        );
        return {
          status: 200 as const,
          body: { success: true as const, eventId },
        };
      } catch (error) {
        fastify.log.error({ err: error, sessionId: id }, 'sendInput was not accepted');
        return {
          status: 409 as const,
          body: {
            success: false as const,
            message: error instanceof Error ? error.message : 'Session did not accept the message',
          },
        };
      }
    },
  };
}
