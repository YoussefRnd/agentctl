import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exploreSchema = z.object({
  path: z.string().optional(),
});

export const fsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/fs/explore',
    {
      schema: {
        body: exploreSchema,
      },
    },
    async (request) => {
      const targetPath = request.body.path ?? os.homedir();
      
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) {
          return { error: 'Not a directory', path: targetPath };
        }

        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        
        const folders = entries
          .filter(e => e.isDirectory())
          .map(e => ({
            name: e.name,
            path: path.join(targetPath, e.name),
            isRepo: false, // Future: check for .git
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          currentPath: targetPath,
          parentPath: path.dirname(targetPath),
          folders,
        };
      } catch {
        return { error: 'Failed to read directory', path: targetPath };
      }
    }
  );

  done();
};
