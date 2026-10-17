import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const execute = promisify(execFile);
const run = (file, args) => execute(file, args, { env: childEnv });
const checker = resolve(import.meta.dirname, '../check-architecture.mjs');

test('the real checker accepts a clean fixture and diagnoses deliberate module and coverage violations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentctl-boundaries-'));
  const files = new Set();
  async function write(file, value) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
    files.add(file);
  }
  try {
    await run('git', ['init', '--quiet', root]);
    const packages = [];
    for (const name of ['shared', 'api-client', 'core', 'ui', 'server']) {
      const directory = name === 'server' ? 'apps/server' : `packages/${name}`;
      await mkdir(join(root, directory, 'src'), { recursive: true });
      await write(`${directory}/package.json`, {
        name: `@agentctl/${name}`,
        exports: { '.': './src/index.ts' },
      });
      packages.push({ package: `@agentctl/${name}`, root: directory, entries: ['.'] });
    }
    for (const name of ['desktop', 'web'])
      await mkdir(join(root, `apps/${name}/src`), { recursive: true });
    await write('docs/public-api.json', { packages });
    for (const name of ['core', 'contracts', 'web'])
      await write(`docs/${name}-ownership.json`, { areas: [] });
    await write('docs/evidence.md', 'Fixture acceptance');
    files.add('docs/workspace-ownership.json');
    await write('docs/workspace-ownership.json', {
      areas: [{ owner: 'Fixture', evidence: 'docs/evidence.md', files: [...files] }],
    });
    const clean = await run(process.execPath, [checker, '--root', root]);
    assert.match(clean.stdout, /architecture boundaries are valid/);
    await write(
      'packages/core/src/workspace/invalid.ts',
      "export * from '.././git/capabilities/history.js'",
    );
    await write('apps/server/src/routes/invalid.ts', "import fs from 'node:fs'");
    await write('packages/ui/src/invalid.ts', "import '@agentctl/shared'; fetch('/api/product')");
    await write('apps/desktop/src/preload/invalid.ts', "const main = import('../main/index.js')");
    await write('packages/core/src/db/invalid.ts', 'const vault = new CredentialVault()');
    await write(
      'packages/shared/src/invalid.ts',
      "import type { X } from '../../../apps/web/src/app/App.js'",
    );
    await write('packages/shared/src/a.ts', "export * from './b.js'");
    await write('packages/shared/src/b.ts', "export * from './a.js'");
    await assert.rejects(run(process.execPath, [checker, '--root', root]), (error) => {
      for (const expected of [
        'workflows cannot depend on concrete VCS',
        'server transports must delegate',
        'UI cannot own networking',
        'preload must use the shared IPC contract',
        'runtime initialization must be called explicitly',
        'packages/shared cannot depend on apps/web',
        'Contract/client module cycle',
        'File needs an owner',
      ])
        assert.ok(error.stderr.includes(expected), `${expected}\n${error.stderr}`);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
