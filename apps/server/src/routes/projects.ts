import fp from 'fastify-plugin';
import { db, projects, sessions } from '@agentctl/core';

// eslint-disable-next-line @typescript-eslint/require-await
export default fp(async (fastify) => {
  fastify.get('/projects', async (_request, _reply) => {
    const allProjects = await db.select().from(projects);
    const allSessions = await db.select().from(sessions);
    
    // Group sessions by project
    const result = allProjects.map(p => ({
      ...p,
      sessions: allSessions.filter(s => s.projectId === p.id)
    }));
    
    return result;
  });
});
