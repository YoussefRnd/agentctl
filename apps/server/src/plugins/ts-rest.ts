import { initServer } from '@ts-rest/fastify';
import { apiContract } from '@agentctl/shared';
import fp from 'fastify-plugin';

import { createSearchRouter } from './ts-rest/search.router.js';
import { createProjectsRouter } from './ts-rest/projects.router.js';
import { createProvidersRouter } from './ts-rest/providers.router.js';
import { createSessionsRouter } from './ts-rest/sessions.router.js';
import { createSettingsRouter } from './ts-rest/settings.router.js';
import { createMcpRouter } from './ts-rest/mcp.router.js';
import { createDiagnosticsRouter } from './ts-rest/diagnostics.router.js';

export default fp(async (fastify) => {
  const s = initServer();

  const router = s.router(apiContract, {
    ...createSearchRouter(fastify),
    ...createProjectsRouter(fastify),
    ...createProvidersRouter(fastify),
    ...createSessionsRouter(fastify),
    ...createSettingsRouter(fastify),
    ...createMcpRouter(fastify),
    ...createDiagnosticsRouter(fastify),
  });

  await fastify.register(s.plugin(router));
});
