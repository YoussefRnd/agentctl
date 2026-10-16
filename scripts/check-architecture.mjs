import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { importSpecifiers, topLevelCalls } from './architecture/dependencies.mjs';

const workspace = resolve(import.meta.dirname, '..');
const errors = [];
async function scan(directory) {
  for (const entry of await readdir(join(workspace, directory), { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    if (!/\.[jt]sx?$/.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)) continue;
    const source = await readFile(join(workspace, file), 'utf8');
    const imports = importSpecifiers(source, file);
    const forbid = (pattern, reason) => {
      for (const dependency of imports) {
        if (pattern.test(dependency)) errors.push(`${file}: ${reason} (${dependency})`);
      }
    };
    if (file.startsWith('packages/shared/')) {
      forbid(
        /^(?:node:|react(?:\/|$)|@agentctl\/(?:core|api-client|web|server|desktop))/,
        'shared contracts and policies cannot depend on runtime or application adapters',
      );
      if (/\bfetch\s*\(/.test(source)) errors.push(`${file}: HTTP transport belongs in api-client`);
    }
    if (file.startsWith('packages/api-client/')) {
      forbid(
        /^(?:node:|@agentctl\/(?:core|web|server|desktop))/,
        'the browser API client cannot depend on host implementations',
      );
    }
    if (file.startsWith('packages/core/')) {
      forbid(
        /^(?:fastify(?:$|\/)|@fastify\/|react(?:$|\/)|@agentctl\/(?:api-client|web|server|desktop))/,
        'core cannot depend on app transports or UI',
      );
    }
    if (file.startsWith('packages/core/src/session/')) {
      forbid(/(?:^|\/)acp\//, 'session workflows depend on agent contracts, not protocol adapters');
      if (
        !file.includes('/composition/') &&
        !file.endsWith('/manager.ts') &&
        !file.endsWith('/index.ts')
      ) {
        forbid(
          /(?:^|\/)manager\.js$|(?:^|\/)composition\//,
          'session internals cannot depend on the facade or composition',
        );
        if (
          imports.some(
            (dependency) =>
              resolve(workspace, file, '..', dependency) ===
              join(workspace, 'packages/core/src/session/index.js'),
          )
        ) {
          errors.push(`${file}: session internals cannot depend on the public session barrel`);
        }
      }
      if (file.includes('/persistence/')) {
        forbid(
          /node:(?:fs|child_process)|(?:^|\/)(?:runtime|services|commands|projection|execution)\//,
          'session persistence cannot depend on provider, filesystem, or workflow implementations',
        );
      }
    }
    if (file.startsWith('packages/core/src/forge/')) {
      forbid(
        /simple-git|(?:^|\/)git\/|(?:^|\/)db\/|(?:^|\/)session\//,
        'forge adapters cannot own Git mutation, persistence, or session lifecycle',
      );
    }
    if (file.startsWith('packages/core/src/git/capabilities/')) {
      forbid(
        /(?:^|\/)(?:worktree-manager|composition|index)\.js$|forge\/(?!types\.js$)/,
        'Git capabilities cannot depend on the facade, composition, or concrete forge adapters',
      );
    }
    if (file === 'packages/core/src/git/snapshot-comparison.ts') {
      forbid(
        /node:fs|(?:^|\/)(?:mutex|snapshot-service)\.js$/,
        'immutable snapshot comparisons cannot own filesystem mutation or capture locks',
      );
    }
    if (
      file.startsWith('apps/server/src/plugins/ts-rest/') ||
      file.startsWith('apps/server/src/routes/')
    ) {
      forbid(
        /drizzle-orm|@agentctl\/core\/(?:db|acp)|simple-git|node:(?:fs|path|os)/,
        'server transports must delegate persistence, filesystem, and provider workflows',
      );
      if (/\bfastify\.db\b/.test(source))
        errors.push(`${file}: database access belongs in application queries/services`);
    }
    if (file.startsWith('apps/server/src/services/')) {
      forbid(
        /(?:^|\/)(?:routes|plugins)\//,
        'application services cannot depend on server transport handlers',
      );
    }
    if (file.startsWith('packages/core/src/db/') && file !== 'packages/core/src/db/database.ts') {
      for (const call of topLevelCalls(source, file)) {
        if (
          ['DatabaseSync', 'createDatabase', 'getDefaultDatabase', 'loadWorkspaceEnv'].includes(
            call,
          )
        ) {
          errors.push(
            `${file}: database/environment initialization must be called explicitly at startup (${call})`,
          );
        }
      }
    }
  }
}
for (const root of [
  'packages/shared/src',
  'packages/api-client/src',
  'packages/core/src',
  'apps/server/src/plugins/ts-rest',
  'apps/server/src/routes',
  'apps/server/src/services',
])
  await scan(root);
if (errors.length) {
  console.error(
    'Architecture boundary violations:\n' + errors.map((error) => `- ${error}`).join('\n'),
  );
  process.exitCode = 1;
} else console.log('Package and server architecture boundaries are valid.');
