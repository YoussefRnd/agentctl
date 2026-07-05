import fp from 'fastify-plugin';
import { sessions, projects } from '@agentctl/core';
import { eq, notInArray, and } from 'drizzle-orm';

export default fp(async (fastify) => {
  const { db, worktreeManager } = fastify;

  // Run worktree sync once on startup
  try {
    fastify.log.info('Starting startup worktree sync...');

    const allProjects = await db.select().from(projects);

    for (const project of allProjects) {
      // Only git-tracked projects have worktrees to sync
      if (!project.repoRoot) continue;

      // Fetch active session IDs (exclude terminal statuses)
      const activeSessions = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.projectId, project.id),
            notInArray(sessions.status, ['merged', 'discarded']),
          ),
        );

      const activeIds = activeSessions.map((s: { id: string }) => s.id);
      await worktreeManager.sync(project.repoRoot, activeIds);
    }

    fastify.log.info('Startup worktree sync completed successfully.');
  } catch (err) {
    fastify.log.error(err, 'Failed to sync worktrees on startup');
  }
});
