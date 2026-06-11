/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { initServer } from '@ts-rest/fastify';
import { apiContract } from '@agentctl/shared';
import fp from 'fastify-plugin';
import { projects, sessions } from '@agentctl/core';
import { eq } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from '../errors/app-error.js';
import type { 
  SessionWithCapabilities,
} from '@agentctl/shared';

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
    loginProvider: async ({ params, body }: any) => {
      const { id } = params;
      const { methodId, params: loginParams } = body;
      await fastify.providerRegistry.login(id, methodId, loginParams);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    activateProvider: async ({ params }: any) => {
      const { id } = params;
      const result = await fastify.providerRegistry.activate(id);
      return {
        status: 200 as const,
        body: result as any,
      };
    },
    refreshProvider: async ({ params }: any) => {
      const { id } = params;
      const result = await fastify.providerRegistry.refreshProvider(id);
      return {
        status: 200 as const,
        body: result as any,
      };
    },
    toggleProvider: async ({ params, body }: any) => {
      const { id } = params;
      const { enabled } = body;
      const result = await fastify.providerRegistry.setProviderEnabled(id, enabled);
      return {
        status: 200 as const,
        body: result as any,
      };
    },
    setProviderConfig: async ({ params, body }: any) => {
      const { id } = params;
      const { customEnv } = body;
      const result = await fastify.providerRegistry.setProviderConfig(id, customEnv);
      return {
        status: 200 as const,
        body: result as any,
      };
    },
    syncProviders: async () => {
      await fastify.providerRegistry.sync();
      const providers = await fastify.providerRegistry.discover();
      return {
        status: 200 as const,
        body: providers,
      };
    },
    getProjects: async ({ query }: any) => {
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
          sessions: projSessions,
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
        body: mapped as any[],
      };
    },
    getSessions: async () => {
      const allSessions = await fastify.db.select().from(sessions);
      return {
        status: 200 as const,
        body: allSessions as any[],
      };
    },
    createSession: async ({ body }: any) => {
      const session = await fastify.sessionService.createSession({
        projectId: body.projectId,
        providerId: body.agent,
        taskSlug: body.taskSlug ?? 'new-session',
        mode: body.mode ?? 'worktree',
      });
      return {
        status: 201 as const,
        body: session as any,
      };
    },
    getSessionById: async ({ params }: any) => {
      const { id } = params;
      const result = await fastify.sessionService.getSessionWithCapabilities(id);
      return {
        status: 200 as const,
        body: result as SessionWithCapabilities,
      };
    },
    getSessionBranches: async ({ params }: any) => {
      const { id } = params;
      const result = await fastify.sessionService.listBranches(id);
      return {
        status: 200 as const,
        body: result,
      };
    },
    switchSessionBranch: async ({ params, body }: any) => {
      const { id } = params;
      const { branch } = body;
      await fastify.sessionService.checkoutBranch(id, branch);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    updateSessionProvider: async ({ params, body }: any) => {
      const { id } = params;
      const { providerId, modelId } = body;
      await fastify.sessionService.updateSessionProvider(id, {
        selectedProvider: providerId,
        selectedModel: modelId ?? '',
        selectedThinkingEffort: 'medium', // Default for now
      });
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    switchSessionMode: async ({ params, body }: any) => {
      const { id } = params;
      const { mode } = body;
      await fastify.sessionService.switchMode(id, mode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    setApprovalMode: async ({ params, body }: any) => {
      const { id } = params;
      const { approvalMode } = body;
      await fastify.sessionService.updateApprovalMode(id, approvalMode);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    mergeSession: async ({ params, body }: any) => {
      const { id } = params;
      const { commitMessage } = body;
      await fastify.sessionService.finalizeSession(id, 'merge', commitMessage);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    discardSession: async ({ params }: any) => {
      const { id } = params;
      await fastify.sessionService.finalizeSession(id, 'discard');
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    deleteSession: async ({ params }: any) => {
      const { id } = params;
      await fastify.sessionService.deleteSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    archiveSession: async ({ params }: any) => {
      const { id } = params;
      await fastify.sessionService.archiveSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    restoreSession: async ({ params }: any) => {
      const { id } = params;
      await fastify.sessionService.restartSession(id);
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    deleteProject: async ({ params }: any) => {
      const { id } = params;
      await fastify.db.delete(projects).where(eq(projects.id, id));
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    getSettings: async () => {
      const raw = await fastify.providerRegistry.getSettings();
      return {
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
        },
      };
    },
    patchSettings: async ({ body }: any) => {
      if (body.onboardingCompleted !== undefined) {
        await fastify.providerRegistry.updateSetting('onboardingCompleted', String(body.onboardingCompleted));
      }
      if (body.onboardingVersion !== undefined) {
        await fastify.providerRegistry.updateSetting('onboardingVersion', String(body.onboardingVersion));
      }
      if (body.setupStep !== undefined) {
        await fastify.providerRegistry.updateSetting('setupStep', body.setupStep ?? '');
      }
      if (body.defaultProviderId !== undefined) {
        await fastify.providerRegistry.updateSetting('defaultProviderId', body.defaultProviderId ?? '');
      }
      const raw = await fastify.providerRegistry.getSettings();
      return {
        status: 200 as const,
        body: {
          onboardingCompleted: raw.onboardingCompleted === 'true',
          onboardingVersion: raw.onboardingVersion ?? '1.0.0',
          setupStep: raw.setupStep ?? null,
          defaultProviderId: raw.defaultProviderId ?? null,
        },
      };
    },
    exploreFs: async ({ body }: any) => {
      const targetPath = body.path ?? os.homedir();
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) {
          return {
            status: 200 as const,
            body: { currentPath: targetPath, parentPath: path.dirname(targetPath), folders: [], error: 'Not a directory' },
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
        folders.sort((a, b) => (a.isRepo === b.isRepo ? a.name.localeCompare(b.name) : a.isRepo ? -1 : 1));
        return {
          status: 200 as const,
          body: { currentPath: targetPath, parentPath: path.dirname(targetPath), folders },
        };
      } catch (err: any) {
        return {
          status: 200 as const,
          body: { currentPath: targetPath, parentPath: path.dirname(targetPath), folders: [], error: err.message },
        };
      }
    },
    getSessionReview: async ({ params }: any) => {
      const { id } = params;
      const session = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({
        where: eq(projects.id, session.projectId),
      });
      if (!project?.repoRoot || session.baseCommit === 'none') return { status: 200 as const, body: { files: [] } };
      const files = await fastify.worktreeManager.getReviewFiles(project.repoRoot, session.worktreePath, session.baseCommit);
      return { status: 200 as const, body: { files: files as any[] } };
    },
    stageFile: async ({ params, body }: any) => {
      const { id } = params;
      const { filePath } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({ where: eq(projects.id, session.projectId) });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.stageFile(project.repoRoot, session.worktreePath, filePath);
      return { status: 200 as const, body: { success: true } };
    },
    revertFile: async ({ params, body }: any) => {
      const { id } = params;
      const { filePath } = body;
      const session = await fastify.db.query.sessions.findFirst({ where: eq(sessions.id, id) });
      if (!session) throw new AppError('Session not found', 404);
      const project = await fastify.db.query.projects.findFirst({ where: eq(projects.id, session.projectId) });
      if (!project?.repoRoot) throw new AppError('Project repo root not found', 404);
      await fastify.worktreeManager.revertFile(project.repoRoot, session.worktreePath, filePath);
      return { status: 200 as const, body: { success: true } };
    },
  } as any);

  await fastify.register(s.plugin(router));
});
