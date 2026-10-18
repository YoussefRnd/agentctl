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

test('repository governance accepts a clean fixture and rejects ownership, export and baseline drift', async () => {
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
    assert.match(clean.stdout, /architecture governance is valid/);
    await write('packages/core/src/workspace/unowned.ts', 'export const unowned = true;');
    await write('packages/core/package.json', {
      name: '@agentctl/core',
      exports: { '.': './src/index.ts', './private': './src/private.ts' },
    });
    await write('apps/web/architecture-cycles.json', { 'alpha -> beta': 'exception' });
    await write('apps/web/src/features/session/old.ts', 'export const legacy = true;');
    await assert.rejects(run(process.execPath, [checker, '--root', root]), (error) => {
      for (const expected of [
        'Declared package surfaces changed',
        'File needs an owner',
        'legacy architecture entries',
        'cycle exceptions cannot be added',
      ])
        assert.ok(error.stderr.includes(expected), `${expected}\n${error.stderr}`);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
