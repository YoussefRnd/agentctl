import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { fixture, run, workspace } from './fixtures.mjs';

test('Oxlint architecture rules inspect real ASTs, distinguish deferred initialization and ignore comments/tests', async () => {
  await fixture(async ({ root, write }) => {
    await write('.oxlintrc.json', {
      jsPlugins: [
        { name: 'agentctl', specifier: join(workspace, 'scripts/oxlint/architecture.mjs') },
      ],
      rules: {
        'agentctl/no-owned-networking': 'error',
        'agentctl/no-transport-database': 'error',
        'agentctl/explicit-runtime-initialization': 'error',
      },
    });
    const lint = async () => {
      let output;
      let exitCode = 0;
      try {
        output = (
          await run(
            process.execPath,
            [
              join(workspace, 'node_modules/vite-plus/bin/vp'),
              'lint',
              '--config',
              join(root, '.oxlintrc.json'),
              '--format',
              'json',
              'packages',
              'apps',
            ],
            { cwd: root },
          )
        ).stdout;
      } catch (error) {
        if (error.code !== 1 || !error.stdout) throw error;
        output = error.stdout;
        exitCode = 1;
      }
      return { ...JSON.parse(output), exitCode };
    };
    await write(
      'packages/ui/src/valid.ts',
      `
      // fetch('/api'); new WebSocket('ws://example');
      export const text = "fetch('/api'); fastify.db; new CredentialVault()";
    `,
    );
    await write(
      'packages/core/src/db/factories.ts',
      `
      export function create() { return new DatabaseSync(); }
      export const get = () => getDefaultDatabase();
      export class Runtime {
        database = getDefaultDatabase();
        start() { return loadWorkspaceEnv(); }
      }
    `,
    );
    await write('packages/core/src/db/database.ts', 'export const owner = new DatabaseSync();');
    await write('packages/ui/src/network.test.ts', "fetch('/api'); new WebSocket('ws://example');");
    assert.equal((await lint()).exitCode, 0);
    await write(
      'packages/ui/src/invalid.ts',
      `
      fetch('/api');
      new XMLHttpRequest();
      new WebSocket('ws://example');
      globalThis['fetch']('/api');
    `,
    );
    await write('packages/shared/src/invalid.ts', "globalThis.fetch('/api');");
    await write('apps/server/src/routes/invalid.ts', 'fastify.db; fastify["db"]; fastify?.db;');
    await write(
      'packages/core/src/db/invalid.ts',
      `
      const eager = createDatabase();
      const vault = new CredentialVault();
      (() => getDefaultDatabase())();
      class Eager { static database = createDatabase(); }
    `,
    );
    const result = await lint();
    assert.equal(result.exitCode, 1);
    const messages = result.diagnostics.map((item) => item.message);
    assert.equal(
      messages.filter((message) => message.includes('UI cannot own networking')).length,
      4,
    );
    assert.equal(
      messages.filter((message) => message.includes('HTTP transport belongs in api-client')).length,
      1,
    );
    assert.equal(
      messages.filter((message) => message.includes('Database access belongs')).length,
      3,
    );
    assert.equal(
      messages.filter((message) => message.includes('Runtime initialization must')).length,
      4,
    );
  });
});
