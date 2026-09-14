import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { eq } from 'drizzle-orm';
import { projects, sessions } from '@agentctl/core/db';
import { sessionsContract, sessionRowSchema, providerCapabilitySchema } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';

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
        taskSlug: body.taskSlug ?? 'new-session',
        mode: body.mode,
      });
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
    switchSessionBranch: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { branch: string };
    }) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.checkoutBranch(id, branch);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    updateSessionProvider: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { providerId: string; modelId?: string };
    }) => {
      const { id } = params;
      const { providerId, modelId } = body;
      await fastify.sessionService.updateSessionProvider(id, {
        selectedProvider: providerId,
        selectedModel: modelId ?? '',
        selectedThinkingEffort: 'medium',
      });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    switchSessionMode: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { mode: 'local' | 'worktree' };
    }) => {
      const { id } = params;
      const { mode } = body;
      await fastify.sessionService.switchMode(id, mode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setApprovalMode: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { approvalMode: 'review' | 'auto_approve' | 'yolo' };
    }) => {
      const { id } = params;
      const { approvalMode } = body;
      await fastify.sessionService.updateApprovalMode(id, approvalMode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setAgentPersona: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { persona: string };
    }) => {
      const { id } = params;
      const { persona } = body;
      await fastify.sessionManager.setAgentPersona(id, persona);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setSessionConfigOption: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { configId: string; value: string };
    }) => {
      const { id } = params;
      const { configId, value } = body;
      await fastify.sessionManager.setConfigOption(id, configId, value);
      return {
        status: 200 as const,
        body: { success: true },
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
    deleteSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.deleteSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    renameSession: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { title: string };
    }) => {
      const { id } = params;
      const { title } = body;
      await fastify.sessionService.renameSession(id, title);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    archiveSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.archiveSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    restoreSession: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.sessionService.restartSession(id);
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
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    checkMergeBranch: async ({
      params,
      body,
    }: {
      params: { id: string };
      body: { branch: string };
    }) => {
      const { id } = params;
      const { branch } = body;
      const result = await fastify.sessionService.checkMergeBranch(id, branch);
      return {
        status: 200 as const,
        body: result,
      };
    },
    spawnParallelAgent: async ({ params, body }) => {
      const { id } = params;
      const session = await fastify.sessionService.spawnParallelAgent(id, body);
      return {
        status: 200 as const,
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
      void Promise.resolve(
        fastify.sessionManager.handleClientMessage(id, 'session.input', {
          input,
          attachmentIds,
        }),
      ).catch((err: unknown) => {
        fastify.log.error({ err, sessionId: id }, 'sendInput handleClientMessage failed');
      });

      await Promise.resolve();
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
  };
}
