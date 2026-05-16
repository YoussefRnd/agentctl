import { z } from 'zod';
import { projects, sessions, GitService } from '@agentctl/core';
import { desc, eq } from 'drizzle-orm';
import path from 'node:path';
import { createAgentSession } from '../utils/session-factory.js';
import { AppError } from '../utils/app-error.js';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance } from 'fastify';

const gitService = new GitService();

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

  const repoInfo = await gitService.resolveRepository(normalizedPath).catch((err: unknown) => {
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

      const session = await createAgentSession(fastify, {
        projectId: project.id,
        agent: request.body.agent,
        taskSlug: request.body.taskSlug ?? 'new-session',
      });

      return {
        project,
        session,
        created: true,
      };
    },
  );

  fastify.get('/projects', async () => {
    const allProjects = await fastify.db.select().from(projects);
    const allSessions = await fastify.db.select().from(sessions);

    // All projects are visible; isGitRepo flag is derived from repoRoot presence
    return allProjects.map((p) => ({
      ...p,
      isGitRepo: p.repoRoot !== null,
      sessions: allSessions.filter((s) => s.projectId === p.id),
    }));
  });

  done();
};
