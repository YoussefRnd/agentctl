import { initServer } from '@ts-rest/fastify';
import { apiContract, sessionRowSchema, providerCapabilitySchema, DEFAULT_FONT_CONFIG, type McpToolResult, type FontConfig } from '@agentctl/shared';
import fp from 'fastify-plugin';
import { projects, sessions, mcpServers } from '@agentctl/core';
import { eq, desc } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from '../errors/app-error.js';

export default fp(async (fastify) => {
  const s = initServer();

  const router = s.router(apiContract, {
    getProviders: async () => {
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    getRegistry: async () => {
      const providers = await fastify.providerRegistry.catalog();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    installProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.install(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    removeProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.remove(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    loginProvider: async ({ params, body }) => {
      const { id } = params;
      const { methodId, params: loginParams } = body;
      await fastify.providerRegistry.login(id, methodId, loginParams);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    logoutProvider: async ({ params }) => {
      const { id } = params;
      await fastify.providerRegistry.logout(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    activateProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    refreshProvider: async ({ params }) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    setProviderConfig: async ({ params, body }) => {
      const { id } = params;
      const { customEnv, nativelyLoadsSkills } = body;
      const result = await fastify.providerRegistry.setProviderConfig(id, {
        customEnv,
        nativelyLoadsSkills,
      });
      return {
        status: 200 as const,
        body: result,
      };
    },
    syncProviders: async () => {
      await fastify.providerRegistry.sync({ force: true });
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    getProjects: async ({ query }) => {
      const { search, gitOnly, sortBy = 'lastActive', sortOrder = 'desc' } = query;
      const allProjects = await fastify.db.select().from(projects);
      const allSessions = await fastify.db.select().from(sessions);

      let mapped = allProjects.map((p) => {
        const projSessions = allSessions.filter((s) => s.projectId === p.id);
        const lastSessionUpdate = projSessions.reduce(
          (max, s) => (s.updatedAt.getTime() > max ? s.updatedAt.getTime() : max),
          p.updatedAt.getTime(),
        );

        return {
          ...p,
          isGitRepo: p.repoRoot !== null,
          sessions: projSessions.map((s) => sessionRowSchema.parse(s)),
          lastActiveTime: lastSessionUpdate,
        };
      });

      if (search) {
        const q = search.toLowerCase();
        mapped = mapped.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            p.sessions.some((s) =>
              (s.title || s.taskSlug || s.branch || '').toLowerCase().includes(q),
            ),
        );
      }

      if (gitOnly === 'true') {
        mapped = mapped.filter((p) => p.isGitRepo);
      }

      mapped.sort((a, b) => {
        let valA: string | number;
        let valB: string | number;

        if (sortBy === 'name') {
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
        } else if (sortBy === 'createdAt') {
          valA = a.createdAt.getTime();
          valB = b.createdAt.getTime();
        } else {
          valA = a.lastActiveTime;
          valB = b.lastActiveTime;
        }

        if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });

      return {
        status: 200 as const,
        body: mapped,
      };
    },
    openProject: async ({ body }) => {
      const normalizedPath = path.resolve(path.normalize(body.path));

      const repoInfo = await fastify.worktreeManager
        .resolveRepository(normalizedPath)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          throw new AppError(`Cannot open folder: ${msg}`, 400);
        });

      const repoRoot = repoInfo.isGitRepo ? repoInfo.repoRoot : null;
      const subdir = repoInfo.isGitRepo ? repoInfo.workdirPrefix : '';

      const existing = await fastify.db
        .select()
        .from(projects)
        .where(eq(projects.path, normalizedPath))
        .limit(1);

      let project;
      if (existing.length > 0) {
        project = existing[0];

        if (project.repoRoot === null && repoRoot !== null) {
          const [updated] = await fastify.db
            .update(projects)
            .set({ repoRoot, subdir })
            .where(eq(projects.id, project.id))
            .returning();
          project = updated;
        }
      } else {
        const projectName = path.basename(normalizedPath);
        const projectId = crypto.randomUUID();

        const [createdProject] = await fastify.db
          .insert(projects)
          .values({
            id: projectId,
            name: projectName,
            path: normalizedPath,
            repoRoot,
            subdir,
          })
          .returning();
        project = createdProject;
      }

      const existingSessions = await fastify.db
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, project.id))
        .orderBy(desc(sessions.updatedAt))
        .limit(1);

      if (existingSessions.length > 0) {
        return {
          status: 200 as const,
          body: {
            project: { id: project.id, name: project.name, path: project.path },
            session: sessionRowSchema.parse(existingSessions[0]),
            created: false,
          },
        };
      }

      const session = await fastify.sessionService.createSession({
        projectId: project.id,
        providerId: body.agent,
        taskSlug: body.taskSlug ?? 'new-session',
        mode: body.mode,
      });

      return {
        status: 200 as const,
        body: {
          project: { id: project.id, name: project.name, path: project.path },
          session: session,
          created: true,
        },
      };
    },
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
    getSessionBranches: async ({ params }) => {
      const { id } = params;
      const result = await fastify.sessionService.listBranches(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    switchSessionBranch: async ({ params, body }) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.checkoutBranch(id, branch);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    updateSessionProvider: async ({ params, body }) => {
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
    switchSessionMode: async ({ params, body }) => {
      const { id } = params;
      const { mode } = body;
      await fastify.sessionService.switchMode(id, mode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setApprovalMode: async ({ params, body }) => {
      const { id } = params;
      const { approvalMode } = body;
      await fastify.sessionService.updateApprovalMode(id, approvalMode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setAgentPersona: async ({ params, body }) => {
      const { id } = params;
      const { persona } = body;
      await fastify.sessionManager.setAgentPersona(id, persona);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setSessionConfigOption: async ({ params, body }) => {
      const { id } = params;
      const { configId, value } = body;
      await fastify.sessionManager.setConfigOption(id, configId, value);
      return {
        status: 200 as const,
        body: { success: true },
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
      const { commitMessage } = body;
      await fastify.sessionService.finalizeSession(id, 'merge', commitMessage);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    discardSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.finalizeSession(id, 'discard');
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    deleteSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.deleteSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    renameSession: async ({ params, body }) => {
      const { id } = params;
      const { title } = body;
      await fastify.db
        .update(sessions)
        .set({ title })
        .where(eq(sessions.id, id));
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    archiveSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.archiveSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    restoreSession: async ({ params }) => {
      const { id } = params;
      await fastify.sessionService.restartSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    deleteProject: async ({ params }) => {
      const { id } = params;
      await fastify.db.delete(projects).where(eq(projects.id, id));
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    getSettings: async () => {
      const raw = await fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          fontConfig = JSON.parse(raw.fontConfig) as FontConfig;
        } catch {
          /* use default */
        }
      }
      return {
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
          showThinking: raw.showThinking === 'true',
          registrySyncError: raw.registrySyncError ?? null,
          fontConfig,
        },
      };
    },
    patchSettings: async ({ body }) => {
      if (body.onboardingCompleted !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'onboardingCompleted',
          String(body.onboardingCompleted),
        );
      }
      if (body.onboardingVersion !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'onboardingVersion',
          String(body.onboardingVersion),
        );
      }
      if (body.setupStep !== undefined) {
        await fastify.providerRegistry.updateSetting('setupStep', body.setupStep ?? '');
      }
      if (body.defaultProviderId !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'defaultProviderId',
          body.defaultProviderId ?? '',
        );
      }
      if (body.showThinking !== undefined) {
        await fastify.providerRegistry.updateSetting('showThinking', String(body.showThinking));
      }
      if (body.registrySyncError !== undefined) {
        await fastify.providerRegistry.updateSetting(
          'registrySyncError',
          body.registrySyncError ?? '',
        );
      }
      if (body.fontConfig !== undefined) {
        const existing = await fastify.providerRegistry.getSettings();
        const prev = existing.fontConfig ? JSON.parse(existing.fontConfig) as Partial<FontConfig> : {};
        const merged: FontConfig = { ...DEFAULT_FONT_CONFIG, ...prev, ...body.fontConfig };
        await fastify.providerRegistry.updateSetting('fontConfig', JSON.stringify(merged));
      }
      const raw = await fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          fontConfig = JSON.parse(raw.fontConfig) as FontConfig;
        } catch {
          /* use default */
        }
      }
      return {
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
          showThinking: raw.showThinking === 'true',
          registrySyncError: raw.registrySyncError ?? null,
          fontConfig,
        },
      };
    },
    exploreFs: async ({ body }) => {
      const targetPath = body.path ?? os.homedir();
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) {
          return {
            status: 200 as const,
            body: {
              currentPath: targetPath,
              parentPath: path.dirname(targetPath),
              folders: [],
              error: 'Not a directory',
            },
          };
        }
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const folderPromises = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map(async (e) => {
            const fullPath = path.join(targetPath, e.name);
            let isRepo = false;
            try {
              const gitPath = path.join(fullPath, '.git');
              const gitStats = await fs.stat(gitPath);
              isRepo = gitStats.isDirectory();
            } catch {
              // Git directory does not exist or is not readable
            }
            return { name: e.name, path: fullPath, isRepo };
          });
        const folders = await Promise.all(folderPromises);
        folders.sort((a, b) =>
          a.isRepo === b.isRepo ? a.name.localeCompare(b.name) : a.isRepo ? -1 : 1,
        );
        return {
          status: 200 as const,
          body: { currentPath: targetPath, parentPath: path.dirname(targetPath), folders },
        };
      } catch (err: unknown) {
        return {
          status: 200 as const,
          body: {
            currentPath: targetPath,
            parentPath: path.dirname(targetPath),
            folders: [],
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
    getSessionReview: async ({ params }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project) throw new AppError('Project not found', 404);

      if (session.mode === 'local') {
        if (session.baseCommit === 'none') {
          return { status: 200 as const, body: { files: [] } };
        }
        const snapshotService = fastify.sessionService.getSnapshotService();
        const files = await snapshotService.getReviewFiles(
          session.worktreePath,
          session.baseCommit,
        );
        return { status: 200 as const, body: { files } };
      }

      if (!project.repoRoot || session.baseCommit === 'none')
        return { status: 200 as const, body: { files: [] } };
      const files = await fastify.worktreeManager.getReviewFiles(
        project.repoRoot,
        session.worktreePath,
        session.baseCommit,
      );
      return { status: 200 as const, body: { files } };
    },
    stageFile: async ({ params, body }) => {
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
    revertFile: async ({ params, body }) => {
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
    unstageFile: async ({ params, body }) => {
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
    stageAllFiles: async ({ params }) => {
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
    unstageAllFiles: async ({ params }) => {
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
    commitChanges: async ({ params, body }) => {
      const { id } = params;
      const { message } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.commit(project.repoRoot, session.worktreePath, message);
      return { status: 200 as const, body: { success: true } };
    },
    pushChanges: async ({ params }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      const result = await fastify.worktreeManager.push(project.repoRoot, session.worktreePath);
      return { status: 200 as const, body: result };
    },
    pullChanges: async ({ params }) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      const result = await fastify.worktreeManager.pull(project.repoRoot, session.worktreePath);
      return { status: 200 as const, body: result };
    },
    rewindSession: async ({ params, body }) => {
      const { id } = params;
      const { eventId, mode } = body;
      const result = await fastify.sessionService.rewindSession(id, eventId, mode);
      return {
        status: 200 as const,
        body: {
          success: true,
          forkSessionId: result.forkSessionId ?? undefined,
        },
      };
    },
    mergeSessionBranch: async ({ params, body }) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.mergeSessionBranch(id, branch);
      return {
        status: 200 as const,
        body: { success: true },
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
      const { input, attachmentIds } = body;
      try {
        await fastify.sessionManager.handleClientMessage(id, 'session.input', {
          input,
          attachmentIds,
        });
      } catch (err: unknown) {
        fastify.log.error({ err, sessionId: id }, 'sendInput handleClientMessage failed');
        throw err;
      }
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    getMcpServers: async () => {
      const servers = await fastify.db.select().from(mcpServers);
      return {
        status: 200 as const,
        body: servers.map((s) => {
          let status: 'connected' | 'disconnected' | 'disabled' = 'disabled';
          if (s.enabled) {
            status = fastify.mcpGateway.isServerConnected(s.id) ? 'connected' : 'disconnected';
          }
          return {
            id: s.id,
            name: s.name,
            command: s.command,
            launchArgs: s.launchArgs,
            launchEnv: s.launchEnv,
            enabled: s.enabled,
            autoApprove: s.autoApprove,
            approvalPolicy: s.approvalPolicy,
            toolPermissions: s.toolPermissions,
            type: s.type as 'local' | 'remote',
            url: s.url,
            headers: s.headers,
            status,
            error: fastify.mcpGateway.getConnectionError(s.id) ?? null,
          };
        }),
      };
    },
    createMcpServer: async ({ body, request }) => {
      const rawBody = (request as unknown as { body?: Record<string, unknown> }).body;
      const approvalPolicySent = rawBody?.approvalPolicy !== undefined;
      const autoApproveSent = rawBody?.autoApprove !== undefined;

      let approvalPolicy = body.approvalPolicy;
      let autoApprove = body.autoApprove;

      if (!approvalPolicySent && autoApproveSent) {
        approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
      } else if (approvalPolicySent) {
        autoApprove = approvalPolicy === 'auto_approve_all';
      }

      const [created] = await fastify.db
        .insert(mcpServers)
        .values({
          id: body.id,
          name: body.name,
          command: body.command ?? null,
          launchArgs: body.launchArgs ?? '[]',
          launchEnv: body.launchEnv ?? '{}',
          enabled: body.enabled,
          autoApprove,
          approvalPolicy,
          toolPermissions: body.toolPermissions ?? '{}',
          type: body.type,
          url: body.url ?? null,
          headers: body.headers ?? null,
        })
        .returning();
      try {
        await fastify.mcpGateway.reload();
      } catch (err: unknown) {
        fastify.log.error(err, 'Failed to reload MCP gateway on createMcpServer');
      }
      const isConnected = created.enabled && fastify.mcpGateway.isServerConnected(created.id);
      return {
        status: 200 as const,
        body: {
          id: created.id,
          name: created.name,
          command: created.command,
          launchArgs: created.launchArgs,
          launchEnv: created.launchEnv,
          enabled: created.enabled,
          autoApprove: created.autoApprove,
          approvalPolicy: created.approvalPolicy,
          toolPermissions: created.toolPermissions,
          type: created.type as 'local' | 'remote',
          url: created.url,
          headers: created.headers,
          status: created.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled',
        },
      };
    },
    updateMcpServer: async ({ params, body, request }) => {
      const { id } = params;
      const rawBody = (request as unknown as { body?: Record<string, unknown> }).body;
      const approvalPolicySent = rawBody?.approvalPolicy !== undefined;
      const autoApproveSent = rawBody?.autoApprove !== undefined;

      let approvalPolicy = body.approvalPolicy;
      let autoApprove = body.autoApprove;

      if (!approvalPolicySent && autoApproveSent) {
        approvalPolicy = autoApprove ? 'auto_approve_all' : 'always_prompt';
      } else if (approvalPolicySent) {
        autoApprove = approvalPolicy === 'auto_approve_all';
      }

      const results = await fastify.db
        .update(mcpServers)
        .set({
          name: body.name,
          command: body.command === undefined ? undefined : (body.command ?? null),
          launchArgs: body.launchArgs === null ? undefined : body.launchArgs,
          launchEnv: body.launchEnv === null ? undefined : body.launchEnv,
          enabled: body.enabled,
          autoApprove,
          approvalPolicy,
          toolPermissions: body.toolPermissions === null ? '{}' : body.toolPermissions,
          type: body.type,
          url: body.url === undefined ? undefined : (body.url ?? null),
          headers: body.headers === undefined ? undefined : (body.headers ?? null),
          updatedAt: new Date(),
        })
        .where(eq(mcpServers.id, id))
        .returning();
      if (results.length === 0) {
        throw new AppError('MCP server config not found', 404);
      }
      try {
        await fastify.mcpGateway.reload();
      } catch (err: unknown) {
        fastify.log.error(err, 'Failed to reload MCP gateway on updateMcpServer');
      }
      const updated = results[0];
      const isConnected = updated.enabled && fastify.mcpGateway.isServerConnected(updated.id);
      return {
        status: 200 as const,
        body: {
          id: updated.id,
          name: updated.name,
          command: updated.command,
          launchArgs: updated.launchArgs,
          launchEnv: updated.launchEnv,
          enabled: updated.enabled,
          autoApprove: updated.autoApprove,
          approvalPolicy: updated.approvalPolicy,
          toolPermissions: updated.toolPermissions,
          type: updated.type as 'local' | 'remote',
          url: updated.url,
          headers: updated.headers,
          status: updated.enabled ? (isConnected ? 'connected' : 'disconnected') : 'disabled',
        },
      };
    },
    deleteMcpServer: async ({ params }) => {
      const { id } = params;
      const result = await fastify.db.delete(mcpServers).where(eq(mcpServers.id, id)).returning();
      void fastify.mcpGateway.reload().catch((err: unknown) => {
        fastify.log.error(err, 'Failed to reload MCP gateway on deleteMcpServer');
      });
      return {
        status: 200 as const,
        body: { success: result.length > 0 },
      };
    },
    getMcpTools: async () => {
      const tools = await fastify.mcpGateway.getTools();
      return {
        status: 200 as const,
        body: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          serverId: t.serverId,
        })),
      };
    },
    callMcpTool: async ({ body }) => {
      const { serverId, toolName, arguments: args } = body;
      const result = await fastify.mcpGateway.callTool(serverId, toolName, args);
      return {
        status: 200 as const,
        body: result as McpToolResult,
      };
    },
  });

  await fastify.register(s.plugin(router));
});
