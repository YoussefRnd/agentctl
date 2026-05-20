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
          return {
            currentPath: targetPath,
            parentPath: path.dirname(targetPath),
            folders: [],
            error: 'Not a directory',
          };
        }

        const entries = await fs.readdir(targetPath, { withFileTypes: true });

        const folderPromises = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.')) // Filter out hidden and files
          .map(async (e) => {
            const fullPath = path.join(targetPath, e.name);
            let isRepo = false;
            try {
              const gitPath = path.join(fullPath, '.git');
              const gitStats = await fs.stat(gitPath);
              isRepo = gitStats.isDirectory();
            } catch {
              // Not a repo
            }
            return {
              name: e.name,
              path: fullPath,
              isRepo,
            };
          });

        const folders = await Promise.all(folderPromises);
        folders.sort((a, b) => {
          if (a.isRepo && !b.isRepo) return -1;
          if (!a.isRepo && b.isRepo) return 1;
          return a.name.localeCompare(b.name);
        });

        return {
          currentPath: targetPath,
          parentPath: path.dirname(targetPath),
          folders,
        };
      } catch (err) {
        fastify.log.error(err, `Failed to explore path: ${targetPath}`);
        return {
          currentPath: targetPath,
          parentPath: path.dirname(targetPath),
          folders: [],
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    },
  );

  done();
};
