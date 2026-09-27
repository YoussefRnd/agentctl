import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { eq } from 'drizzle-orm';
import { projects, sessions } from '@agentctl/core/db';
import {
  sessionsContract,
  sessionRowSchema,
  providerCapabilitySchema,
  createTaskSlug,
} from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

function publishSessionChange(fastify: FastifyInstance, sessionId: string): void {
  fastify.eventBus.publishState({ topics: ['projects', 'session'], sessionId });
}

function publishWorkspaceChange(fastify: FastifyInstance, sessionId: string): void {
  fastify.eventBus.publishState({
    topics: ['projects', 'session', 'workspace'],
    sessionId,
  });
}

export function createSessionsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof sessionsContract> {
  return {
    getSessions: async () => {
      const allSessions = await fastify.db.select().from(sessions);
      return {
        status: 200 as const,
        body: allSessions.map((s) => sessionRowSchema.parse(s)),
      };
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
      publishSessionChange(fastify, session.id);
      return {
        status: 201 as const,
        body: session,
      };
    },
    getSessionById: async ({ params }: { params: { id: string } }) => {
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
    getSessionBranches: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const result = await fastify.sessionService.listBranches(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    sendTerminalInput: ({
      params,
      body,
    }: {
      params: { id: string; terminalId: string };
      body: { data: string };
    }) => {
      const { id, terminalId } = params;
      const { data } = body;
      const success = fastify.sessionService.writeTerminalInput(id, terminalId, data);
      return Promise.resolve({
        status: 200 as const,
        body: { success },
      });
    },
    mergeSession: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { commitMessage?: string };
    }) => {
      const { id } = params;
      const { commitMessage } = body;
      try {
        await fastify.sessionService.finalizeSession(id, 'merge', commitMessage);
        publishWorkspaceChange(fastify, id);
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
    discardSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      try {
        await fastify.sessionService.finalizeSession(id, 'discard');
        publishWorkspaceChange(fastify, id);
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
    patchSession: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: {
        title?: string;
        mode?: 'local' | 'worktree';
        approvalMode?: 'review' | 'auto_approve' | 'yolo';
        persona?: string;
        providerId?: string;
        modelId?: string;
        thinkingEffort?: 'low' | 'medium' | 'high';
        configId?: string;
        configValue?: string;
        branch?: string;
      };
    }) => {
      const { id } = params;
      if (body.title !== undefined) {
        await fastify.sessionService.renameSession(id, body.title);
      }
      if (body.mode !== undefined) {
        await fastify.sessionService.switchMode(id, body.mode);
      }
      if (body.approvalMode !== undefined) {
        await fastify.sessionService.updateApprovalMode(id, body.approvalMode);
      }
      if (body.providerId !== undefined) {
        await fastify.sessionService.updateSessionProvider(id, {
          selectedProvider: body.providerId,
          selectedModel: body.modelId ?? '',
          selectedThinkingEffort: body.thinkingEffort ?? 'medium',
        });
      }
      if (body.persona !== undefined) {
        await fastify.sessionManager.setAgentPersona(id, body.persona);
      }
      if (body.configId !== undefined && body.configValue !== undefined) {
        await fastify.sessionManager.setConfigOption(id, body.configId, body.configValue);
      }
      if (body.branch !== undefined) {
        await fastify.sessionService.checkoutBranch(id, body.branch);
      }

      const result = await fastify.sessionService.getSessionWithCapabilities(id);
      if (body.branch !== undefined || body.mode !== undefined) {
        publishWorkspaceChange(fastify, id);
      } else {
        publishSessionChange(fastify, id);
      }
      return {
        status: 200 as const,
        body: {
          session: result.session,
          capabilities: result.capabilities.map((c) => providerCapabilitySchema.parse(c)),
        },
      };
    },
    deleteSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.deleteSession(id);
      publishSessionChange(fastify, id);
      return {
        status: 204 as const,
        body: undefined,
      };
    },
    archiveSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.archiveSession(id);
      publishSessionChange(fastify, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    restoreSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.restartSession(id);
      publishSessionChange(fastify, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    getSessionReview: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project) throw new AppError('Project not found', 404);

      if (session.baseCommit === 'none') return { status: 200 as const, body: { files: [] } };
      const snapshotService = fastify.sessionService.getSnapshotService();
      const files = await snapshotService.getReviewFiles(session.worktreePath, session.baseCommit);
      return { status: 200 as const, body: { files } };
    },
    stageFile: async ({ params, body }: { params: { id: string }; body: { filePath: string } }) => {
      const { id } = params;
      const { filePath } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.stageFile(project.repoRoot, session.worktreePath, filePath);
      publishWorkspaceChange(fastify, id);
      return { status: 200 as const, body: { success: true } };
    },
    revertFile: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { filePath: string };
    }) => {
      const { id } = params;
      const { filePath } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.revertFile(project.repoRoot, session.worktreePath, filePath);
      publishWorkspaceChange(fastify, id);
      return { status: 200 as const, body: { success: true } };
    },
    unstageFile: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { filePath: string };
    }) => {
      const { id } = params;
      const { filePath } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.unstageFile(project.repoRoot, session.worktreePath, filePath);
      publishWorkspaceChange(fastify, id);
      return { status: 200 as const, body: { success: true } };
    },
    stageAllFiles: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.stageAll(project.repoRoot, session.worktreePath);
      publishWorkspaceChange(fastify, id);
      return { status: 200 as const, body: { success: true } };
    },
    unstageAllFiles: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.unstageAll(project.repoRoot, session.worktreePath);
      publishWorkspaceChange(fastify, id);
      return { status: 200 as const, body: { success: true } };
    },
    commitChanges: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { message: string };
    }) => {
      const { id } = params;
      const { message } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      try {
        await fastify.worktreeManager.commit(project.repoRoot, session.worktreePath, message);
        publishWorkspaceChange(fastify, id);
        return { status: 200 as const, body: { success: true } };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    pushChanges: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      try {
        const result = await fastify.worktreeManager.push(project.repoRoot, session.worktreePath);
        publishWorkspaceChange(fastify, id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    pullChanges: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      try {
        const result = await fastify.worktreeManager.pull(project.repoRoot, session.worktreePath);
        publishWorkspaceChange(fastify, id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    getGitStatus: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) {
        return {
          status: 200 as const,
          body: {
            isRepo: false,
            branch: null,
            hasPrimaryRemote: false,
            remoteName: null,
            remoteProvider: null,
            upstreamBranch: null,
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          },
        };
      }
      const status = await fastify.worktreeManager.getTrackingStatus(
        project.repoRoot,
        session.worktreePath,
      );
      return { status: 200 as const, body: status };
    },
    createPullRequest: async ({ params, body }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);

      try {
        const result = await fastify.worktreeManager.createPullRequest(
          project.repoRoot,
          session.worktreePath,
          {
            title: body.title,
            body: body.body,
            baseBranch: body.baseBranch,
          },
        );
        publishWorkspaceChange(fastify, id);
        return { status: 200 as const, body: result };
      } catch (err) {
        return {
          status: 400 as const,
          body: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    rewindSession: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { eventId: number; mode: 'conversation' | 'files' | 'fork' };
    }) => {
      const { id } = params;
      const { eventId, mode } = body;
      const result = await fastify.sessionService.rewindSession(id, eventId, mode);
      publishWorkspaceChange(fastify, result.forkSessionId ?? id);
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
    undoRewind: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.undoRewind(id);
      publishWorkspaceChange(fastify, id);
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
      publishSessionChange(fastify, result.sessionId);
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
    restoreSnapshot: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { snapshotHash: string };
    }) => {
      const { id } = params;
      const { snapshotHash } = body;
      const result = await fastify.sessionService.restoreSnapshot(id, snapshotHash);
      publishWorkspaceChange(fastify, id);
      return {
        status: 200 as const,
        body: {
          success: true,
          backupHash: result.backupHash,
        },
      };
    },
    previewSnapshotDiff: async ({ params }: { params: { id: string; eventId: number } }) => {
      const { id, eventId } = params;
      const result = await fastify.sessionService.previewSnapshotDiff(id, eventId);
      return {
        status: 200 as const,
        body: result,
      };
    },
    mergeSessionBranch: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { branch: string };
    }) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.mergeSessionBranch(id, branch);
      publishWorkspaceChange(fastify, id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    checkMergeBranch: async ({
      params,
      query,
    }: {
      params: { id: string };
      query: { branch: string };
    }) => {
      const { id } = params;
      const { branch } = query;
      const result = await fastify.sessionService.checkMergeBranch(id, branch);
      return {
        status: 200 as const,
        body: result,
      };
    },
    spawnParallelAgent: async ({ params, body }) => {
      const { id } = params;
      const session = await fastify.sessionService.spawnParallelAgent(id, body);
      publishSessionChange(fastify, session.id);
      return {
        status: 201 as const,
        body: { session },
      };
    },
    cancelSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionManager.handleClientMessage(id, 'cancel', {});
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    approveEvent: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { eventId: number; optionId?: string };
    }) => {
      const { id } = params;
      const { eventId, optionId } = body;
      await fastify.sessionManager.handleClientMessage(id, 'approve', { eventId, optionId });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    denyEvent: async ({ params, body }: { params: { id: string }; body: { eventId: number } }) => {
      const { id } = params;
      const { eventId } = body;
      await fastify.sessionManager.handleClientMessage(id, 'deny', { eventId });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    sendInput: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { input: string; attachmentIds?: string[] };
    }) => {
      const { id } = params;
      const { input, attachmentIds } = body;
      try {
        const eventId = await fastify.sessionManager.startInput(id, input, attachmentIds);
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
