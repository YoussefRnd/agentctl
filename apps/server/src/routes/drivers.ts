import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { DriverDiscovery } from '@agentctl/shared';

let cachedDrivers: DriverDiscovery[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const driversRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().get(
    '/drivers',
    async () => {
      const now = Date.now();
      if (!cachedDrivers || now - lastFetchTime > CACHE_TTL) {
        fastify.log.info('Refreshing driver discovery cache...');
        cachedDrivers = await fastify.driverRegistry.discover();
        lastFetchTime = now;
      }
      return cachedDrivers;
    }
  );

  done();
};
