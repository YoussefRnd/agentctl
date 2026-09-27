import fp from 'fastify-plugin';

export default fp(async (fastify) => {
  // Finish cleanup before serving requests so a stale startup snapshot cannot
  // remove a newly established workspace.
  try {
    if (typeof fastify.sessionManager.syncOrphans === 'function') {
      await fastify.sessionManager.syncOrphans();
    }
  } catch (err) {
    fastify.log.error(err, 'Failed to sync worktrees on startup');
  }
});
