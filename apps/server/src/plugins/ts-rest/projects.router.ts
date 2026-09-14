import type { FastifyInstance } from 'fastify';
import type { RouterImplementation } from '@ts-rest/fastify';
import { eq, desc } from 'drizzle-orm';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { projects, sessions } from '@agentctl/core/db';
import { projectsContract, sessionRowSchema, type SessionMode } from '@agentctl/shared';
import { AppError } from '../../errors/app-error.js';
import { launchEditorProcess, detectAvailableEditors } from '../../utils/launch-editor.js';

export function createProjectsRouter(
  fastify: FastifyInstance,
): RouterImplementation<typeof projectsContract> {
  return {
    getProjects: async ({
      query,
    }: {
      query: {
        search?: string;
        gitOnly?: 'true' | 'false';
        sortBy?: 'name' | 'lastActive' | 'createdAt';
        sortOrder?: 'asc' | 'desc';
      };
    }) => {
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
    openProject: async ({
      body,
    }: {
      body: { path: string; agent?: string; taskSlug?: string; mode?: SessionMode };
    }) => {
      const trimmedPath = body.path?.trim();
      if (!trimmedPath) {
        throw new AppError('Path cannot be empty', 400);
      }

      let normalizedPath = path.resolve(path.normalize(trimmedPath));

      let pathExists = false;
      try {
        const st = await fs.stat(normalizedPath);
        pathExists = st.isDirectory();
      } catch {
        pathExists = false;
      }

      if (!pathExists) {
        const isExplicitAbsolutePath =
          path.isAbsolute(trimmedPath) || path.win32.isAbsolute(trimmedPath);
        if (isExplicitAbsolutePath) {
          throw new AppError(`Cannot open folder: path does not exist: ${trimmedPath}`, 400);
        }

        const rawName = path.basename(trimmedPath);
        const isBareFolderName = rawName === trimmedPath && !trimmedPath.includes('\\');
        if (rawName && rawName !== '.' && isBareFolderName) {
          const candidatePaths = new Set<string>();

          const knownProjects = await fastify.db.select({ path: projects.path }).from(projects);
          for (const kp of knownProjects) {
            if (kp.path) {
              candidatePaths.add(path.join(path.dirname(kp.path), rawName));
            }
          }

          const configuredRoots = fastify.config.AGENTCTL_WORKSPACE_SEARCH_PATHS?.split(
            path.delimiter,
          )
            .map((root) => root.trim())
            .filter(Boolean);
          const home = os.homedir();
          const searchRoots = configuredRoots?.length
            ? configuredRoots
            : [
                home,
                ...['Documents', 'Projects', 'Code', 'Desktop'].map((dir) => path.join(home, dir)),
              ];
          for (const root of searchRoots) {
            candidatePaths.add(path.join(root, rawName));
          }

          const matches = new Set<string>();
          for (const candidate of candidatePaths) {
            try {
              const st = await fs.stat(candidate);
              if (st.isDirectory()) {
                matches.add(await fs.realpath(candidate));
              }
            } catch {
              // continue
            }
          }

          if (matches.size > 1) {
            throw new AppError(
              `Cannot open folder: multiple folders named "${rawName}" were found; use the full path`,
              400,
            );
          }
          const [match] = matches;
          if (match) {
            normalizedPath = match;
            pathExists = true;
          }
        }
      }

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
    openInEditor: async ({ body }: { body: { editor: string; path: string } }) => {
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
    deleteProject: async ({ params }: { params: { id: string } }) => {
      const { id } = params;
      await fastify.db.delete(projects).where(eq(projects.id, id));
      return {
        status: 200 as const,
        body: { success: true },
      };
    },
    exploreFs: async ({ body }: { body: { path?: string } }) => {
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
  };
}
