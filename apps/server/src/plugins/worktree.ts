import fp from 'fastify-plugin';
import { WorktreeManager, GitMutex, db, sessions, projects } from '@agentctl/core';
import { eq, notInArray, and } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyInstance {
    worktreeManager: WorktreeManager;
    gitMutex: GitMutex;
  }
}

export default fp((fastify) => {
  const mutex = new GitMutex();
  fastify.decorate('gitMutex', mutex);

  const manager = new WorktreeManager(mutex);
  fastify.decorate('worktreeManager', manager);

  // Background sync interval (every 5 minutes)
  const syncInterval = setInterval(() => {
    void (async () => {
      try {
        fastify.log.info('Starting background worktree sync...');

        const allProjects = await db.select().from(projects);

        for (const project of allProjects) {
          // Fetch active session IDs (exclude terminal statuses)
          const activeSessions = await db
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              and(
                eq(sessions.projectId, project.id),
                notInArray(sessions.status, ['merged', 'discarded'])
              )
            );

          const activeIds = activeSessions.map((s) => s.id);
          await manager.sync(project.path, activeIds);
        }

        fastify.log.info('Background worktree sync completed successfully.');
      } catch (err) {
        fastify.log.error(err, 'Failed to sync worktrees in background');
      }
    })();
  }, 5 * 60 * 1000);

  fastify.addHook('onClose', () => {
    clearInterval(syncInterval);
    return Promise.resolve();
  });

  return Promise.resolve();
});
