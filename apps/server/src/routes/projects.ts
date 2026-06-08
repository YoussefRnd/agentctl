import { z } from 'zod';
import { projects, sessions } from '@agentctl/core';
import { desc, eq } from 'drizzle-orm';
import path from 'node:path';
import { AppError } from '../errors/app-error.js';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance } from 'fastify';

const createProjectSchema = z.object({
  path: z.string().min(1),
});

const openProjectSchema = createProjectSchema.extend({
  agent: z.string().min(1),
  taskSlug: z.string().min(1).optional(),
});

/**
 * Resolves a user-selected path to a project record.
 * Non-git folders are accepted; they just won't support worktrees / sessions.
 */
async function findOrCreateProject(fastify: FastifyInstance, selectedPath: string) {
  const normalizedPath = path.resolve(path.normalize(selectedPath));

  const repoInfo = await fastify.worktreeManager.resolveRepository(normalizedPath).catch((err: unknown) => {
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

  if (existing.length > 0) {
    const project = existing[0];

    // Back-fill repoRoot/subdir if this project was recorded before Phase 2
    if (project.repoRoot === null && repoRoot !== null) {
      const [updated] = await fastify.db
        .update(projects)
        .set({ repoRoot, subdir })
        .where(eq(projects.id, project.id))
        .returning();
      return updated;
    }

    return project;
  }

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

  return createdProject;
}

export const projectsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/projects',
    {
      schema: {
        body: createProjectSchema,
      },
    },
    async (request) => {
      const project = await findOrCreateProject(fastify, request.body.path);
      return { project };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/projects/open',
    {
      schema: {
        body: openProjectSchema,
      },
    },
    async (request) => {
      const project = await findOrCreateProject(fastify, request.body.path);

      const existingSessions = await fastify.db
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, project.id))
        .orderBy(desc(sessions.updatedAt))
        .limit(1);

      if (existingSessions.length > 0) {
        return {
          project,
          session: existingSessions[0],
          created: false,
        };
      }

      const session = await fastify.sessionManager.createSession({
        projectId: project.id,
        providerId: request.body.agent,
        taskSlug: request.body.taskSlug ?? 'new-session',
      });

      const sessionRecord = await fastify.db.query.sessions.findFirst({
        where: eq(sessions.id, session.sessionId),
        with: { project: true },
      });

      return {
        project,
        session: sessionRecord,
        created: true,
      };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/projects',
    {
      schema: {
        querystring: z.object({
          search: z.string().optional(),
          gitOnly: z.enum(['true', 'false']).optional(),
          sortBy: z.enum(['name', 'lastActive', 'createdAt']).optional(),
          sortOrder: z.enum(['asc', 'desc']).optional(),
        }),
      },
    },
    async (request) => {
      const { search, gitOnly, sortBy = 'lastActive', sortOrder = 'desc' } = request.query;

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
        const query = search.toLowerCase();
        mapped = mapped.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.path.toLowerCase().includes(query) ||
            p.sessions.some((s) =>
              (s.title || s.taskSlug || s.branch || '').toLowerCase().includes(query),
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

      return mapped;
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().delete(
    '/projects/:id',
    {
      schema: {
        params: z.object({
          id: z.uuid(),
        }),
      },
    },
    async (request) => {
      await fastify.sessionManager.deleteProject(request.params.id);
      return { success: true };
    },
  );

  done();
};
