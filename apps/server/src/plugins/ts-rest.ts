import { initServer } from '@ts-rest/fastify';
import {
  apiContract,
  sessionRowSchema,
  providerCapabilitySchema,
  DEFAULT_FONT_CONFIG,
  type McpToolResult,
  type FontConfig,
  type SearchEventType,
  type SearchResultItem,
} from '@agentctl/shared';
import fp from 'fastify-plugin';
import { projects, sessions, mcpServers, acpEvents } from '@agentctl/core/db';
import { and, eq, desc, sql, type SQL } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from '../errors/app-error.js';
import { launchEditorProcess, detectAvailableEditors } from '../utils/launch-editor.js';

function extractEventSearchableText(type: string, data: unknown): string {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return extractEventSearchableText(type, parsed);
    } catch {
      return data;
    }
  }
  if (!data || typeof data !== 'object') return '';

  const obj = data as Record<string, unknown>;
  if (type === 'text') {
    return typeof obj.content === 'string' ? obj.content : '';
  }

  if (type === 'tool_call') {
    return [obj.name, obj.title, obj.arguments, obj.rawInput, obj.content, obj.rawOutput]
      .filter((value) => value != null)
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .join(' ');
  }

  return JSON.stringify(obj);
}

function categorizeSearchEvent(
  type: string,
  data: Record<string, unknown> | null,
): SearchEventType | null {
  if (type === 'tool_call') return 'tool';
  if (type !== 'text') return null;
  if (data?.role === 'user') return 'user';
  if (data?.role === 'thought') return 'thought';
  return 'agent';
}

function createSearchSnippet(
  text: string,
  query: string,
): { snippet: string; matchIndices: [number, number] } {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return {
      snippet: text.slice(0, 120),
      matchIndices: [0, 0],
    };
  }

  const snippetRadius = 45;
  const start = Math.max(0, index - snippetRadius);
  const end = Math.min(text.length, index + query.length + snippetRadius);
  const rawSnippet = text.substring(start, end);

  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const formattedSnippet = `${prefix}${rawSnippet}${suffix}`;

  const matchStart = prefix.length + (index - start);
  const matchEnd = matchStart + query.length;

  return {
    snippet: formattedSnippet,
    matchIndices: [matchStart, matchEnd],
  };
}

export default fp(async (fastify) => {
  const s = initServer();

  const router = s.router(apiContract, {
    searchEvents: async ({ query }) => {
      const { q, type, projectId, sessionId, limit = 25 } = query;
      const cleanQ = q.trim();
      if (!cleanQ) {
        return {
          status: 200 as const,
          body: [],
        };
      }

      const searchableText = sql<string>`
        CASE
          WHEN json_valid(${acpEvents.data}) = 0 THEN ${acpEvents.data}
          WHEN ${acpEvents.type} = 'text'
            THEN coalesce(json_extract(${acpEvents.data}, '$.content'), '')
          WHEN ${acpEvents.type} = 'tool_call'
            THEN
              coalesce(json_extract(${acpEvents.data}, '$.name'), '') || ' ' ||
              coalesce(json_extract(${acpEvents.data}, '$.title'), '') || ' ' ||
              coalesce(json_extract(${acpEvents.data}, '$.arguments'), '') || ' ' ||
              coalesce(json_extract(${acpEvents.data}, '$.rawInput'), '') || ' ' ||
              coalesce(json_extract(${acpEvents.data}, '$.content'), '') || ' ' ||
              coalesce(json_extract(${acpEvents.data}, '$.rawOutput'), '')
          ELSE ''
        END
      `;
      const conditions: SQL[] = [
        sql`${acpEvents.type} IN ('text', 'tool_call')`,
        sql`instr(lower(${searchableText}), lower(${cleanQ})) > 0`,
      ];
      const eventRole = sql<string | null>`
        CASE
          WHEN json_valid(${acpEvents.data}) = 1
            THEN json_extract(${acpEvents.data}, '$.role')
          ELSE NULL
        END
      `;

      if (sessionId) conditions.push(eq(acpEvents.sessionId, sessionId));
      if (projectId) conditions.push(eq(sessions.projectId, projectId));

      if (type && type !== 'all') {
        if (type === 'tool') {
          conditions.push(eq(acpEvents.type, 'tool_call'));
        } else {
          conditions.push(eq(acpEvents.type, 'text'));
          if (type === 'user' || type === 'thought') {
            conditions.push(sql`${eventRole} = ${type}`);
          } else {
            conditions.push(sql`coalesce(${eventRole}, 'provider') NOT IN ('user', 'thought')`);
          }
        }
      }

      const rows = await fastify.db
        .select({
          eventId: acpEvents.id,
          eventType: acpEvents.type,
          eventData: acpEvents.data,
          eventCreatedAt: acpEvents.createdAt,
          sessionId: sessions.id,
          sessionTitle: sessions.title,
          sessionTaskSlug: sessions.taskSlug,
          projectId: sessions.projectId,
          projectName: projects.name,
        })
        .from(acpEvents)
        .innerJoin(sessions, eq(acpEvents.sessionId, sessions.id))
        .leftJoin(projects, eq(sessions.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(desc(acpEvents.id))
        .limit(limit);

      const results: SearchResultItem[] = [];

      for (const row of rows) {
        let parsedData: Record<string, unknown> | null = null;
        try {
          parsedData = JSON.parse(row.eventData) as Record<string, unknown>;
        } catch {
          parsedData = null;
        }

        const category = categorizeSearchEvent(row.eventType, parsedData);
        if (!category) continue;
        const text = extractEventSearchableText(row.eventType, parsedData ?? row.eventData);
        if (!text || !text.toLowerCase().includes(cleanQ.toLowerCase())) {
          continue;
        }

        const { snippet, matchIndices } = createSearchSnippet(text, cleanQ);

        results.push({
          eventId: row.eventId,
          sessionId: row.sessionId,
          sessionTitle: row.sessionTitle || row.sessionTaskSlug || 'Untitled Session',
          projectId: row.projectId,
          projectName: row.projectName ?? 'Unknown Project',
          eventType: category,
          snippet,
          matchIndices,
          createdAt: row.eventCreatedAt
            ? new Date(row.eventCreatedAt).toISOString()
            : new Date().toISOString(),
        });
      }

      return {
        status: 200 as const,
        body: results,
      };
    },
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
      await fastify.providerRegistry.sync();
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
          sessions: projSessions
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .map((s) => sessionRowSchema.parse(s)),
          lastActiveTime: lastSessionUpdate,
        };
      });

      if (search) {
        const q = search.toLowerCase();
        mapped = mapped.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.path.toLowerCase().includes(q) ||
            p.sessions.some(
              (s: { title?: string | null; taskSlug?: string | null; branch?: string | null }) =>
                (s.title ?? s.taskSlug ?? s.branch ?? '').toLowerCase().includes(q),
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
    getAvailableEditors: async () => {
      const available = await detectAvailableEditors();
      return {
        status: 200 as const,
        body: available,
      };
    },
    openInEditor: async ({ body }) => {
      const result = await launchEditorProcess(body.editor, body.path);
      if (!result.success) {
        return {
          status: 500 as const,
          body: {
            message: result.error ?? `Failed to launch ${body.editor}`,
          },
        };
      }
      return {
        status: 200 as const,
        body: {
          success: true,
          editor: body.editor,
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
      await fastify.sessionService.renameSession(id, title);
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
    getSettings: () => {
      const raw = fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          const parsed = JSON.parse(raw.fontConfig) as Record<
            string,
            { family: string; size: number } | undefined
          >;
          fontConfig = {
            ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
            code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
          };
        } catch {
          /* use default */
        }
      }
      return Promise.resolve({
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
      });
    },
    patchSettings: ({ body }) => {
      if (body.onboardingCompleted !== undefined) {
        fastify.providerRegistry.updateSetting(
          'onboardingCompleted',
          String(body.onboardingCompleted),
        );
      }
      if (body.onboardingVersion !== undefined) {
        fastify.providerRegistry.updateSetting('onboardingVersion', String(body.onboardingVersion));
      }
      if (body.setupStep !== undefined) {
        fastify.providerRegistry.updateSetting('setupStep', body.setupStep ?? '');
      }
      if (body.defaultProviderId !== undefined) {
        fastify.providerRegistry.updateSetting('defaultProviderId', body.defaultProviderId ?? '');
      }
      if (body.showThinking !== undefined) {
        fastify.providerRegistry.updateSetting('showThinking', String(body.showThinking));
      }
      if (body.registrySyncError !== undefined) {
        fastify.providerRegistry.updateSetting('registrySyncError', body.registrySyncError ?? '');
      }
      if (body.fontConfig !== undefined) {
        const existing = fastify.providerRegistry.getSettings();
        let prev = DEFAULT_FONT_CONFIG;
        if (existing.fontConfig) {
          try {
            const parsed = JSON.parse(existing.fontConfig) as Record<
              string,
              { family: string; size: number } | undefined
            >;
            prev = {
              ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
              code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
            };
          } catch {
            /* use default */
          }
        }
        const merged: FontConfig = {
          ui: body.fontConfig.ui ? { ...prev.ui, ...body.fontConfig.ui } : prev.ui,
          code: body.fontConfig.code ? { ...prev.code, ...body.fontConfig.code } : prev.code,
        };
        fastify.providerRegistry.updateSetting('fontConfig', JSON.stringify(merged));
      }
      const raw = fastify.providerRegistry.getSettings();
      let fontConfig: FontConfig = DEFAULT_FONT_CONFIG;
      if (raw.fontConfig) {
        try {
          const parsed = JSON.parse(raw.fontConfig) as Record<
            string,
            { family: string; size: number } | undefined
          >;
          fontConfig = {
            ui: parsed.ui ?? parsed.chat ?? DEFAULT_FONT_CONFIG.ui,
            code: parsed.code ?? parsed.buffer ?? parsed.terminal ?? DEFAULT_FONT_CONFIG.code,
          };
        } catch {
          /* use default */
        }
      }
      return Promise.resolve({
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
      });
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

      if (session.baseCommit === 'none') return { status: 200 as const, body: { files: [] } };
      const snapshotService = fastify.sessionService.getSnapshotService();
      const files = await snapshotService.getReviewFiles(session.worktreePath, session.baseCommit);
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
          undoSnapshotHash: result.undoSnapshotHash ?? undefined,
        },
      };
    },
    restoreSnapshot: async ({ params, body }) => {
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
    previewSnapshotDiff: async ({ params }) => {
      const { id, eventId } = params;
      const result = await fastify.sessionService.previewSnapshotDiff(id, eventId);
      return {
        status: 200 as const,
        body: result,
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
    checkMergeBranch: async ({ params, body }) => {
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
