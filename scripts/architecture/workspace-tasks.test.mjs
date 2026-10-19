import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const execute = promisify(execFile);
const workspace = resolve(import.meta.dirname, '../..');
const cli = join(workspace, 'node_modules/vite-plus/bin/vp');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

test('workspace tasks order dependencies, restore artifacts, invalidate sources and preserve dev env', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentctl-vp-cache-'));
  const write = async (path, content) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  try {
    const manifest = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
    const toolchain = JSON.parse(
      await readFile(join(workspace, 'node_modules/vite-plus/package.json'), 'utf8'),
    );
    await write(
      'package.json',
      JSON.stringify({
        name: 'fixture',
        private: true,
        type: 'module',
        packageManager: manifest.packageManager,
        devDependencies: { 'vite-plus': toolchain.version },
      }),
    );
    await write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    await mkdir(join(root, 'apps'));
    await write(
      'scripts/workspace-tasks.mjs',
      await readFile(join(workspace, 'scripts/workspace-tasks.mjs'), 'utf8'),
    );
    await write(
      'scripts/run-build-steps.mjs',
      await readFile(join(workspace, 'scripts/run-build-steps.mjs'), 'utf8'),
    );
    await mkdir(join(root, 'node_modules'));
    await symlink(
      join(workspace, 'node_modules/vite-plus'),
      join(root, 'node_modules/vite-plus'),
      'dir',
    );
    for (const name of ['dep', 'app', 'renderer', 'styles', 'unrelated']) {
      await write(
        `packages/${name}/package.json`,
        JSON.stringify({
          name: `@fixture/${name}`,
          type: 'module',
          scripts: { build: 'vp run compile', dev: 'vp run watch' },
          ...(name === 'app' ? { dependencies: { '@fixture/dep': 'workspace:*' } } : {}),
          ...(name === 'renderer' ? { dependencies: { '@fixture/styles': 'workspace:*' } } : {}),
        }),
      );
      await write(
        `packages/${name}/vite.config.mjs`,
        `import { createWorkspaceTasks } from '../../scripts/workspace-tasks.mjs';
export default { run: createWorkspaceTasks(import.meta.dirname, {
  build: 'node ../../scripts/run-build-steps.mjs node build.mjs -- node finalize.mjs',
  typecheck: 'node --version', dev: 'node dev.mjs',
  ${name === 'app' ? "buildDependencies: ['@fixture/renderer#compile'], inputs: ['packages/app/fixtures/**']," : ''}
}) };`,
      );
      await write(`packages/${name}/src/value.txt`, `${name}-a`);
      await write(
        `packages/${name}/build.mjs`,
        `import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
let value = readFileSync('src/value.txt', 'utf8');
${name === 'app' ? "value = readFileSync('../dep/dist/value.txt', 'utf8') + '+' + value;" : ''}
mkdirSync('dist', { recursive: true });
writeFileSync('dist/value.txt', value);
writeFileSync('dist/intermediate.txt', 'removed by the next build step');
appendFileSync('runs.log', 'build\\n');`,
      );
      await write(
        `packages/${name}/finalize.mjs`,
        "import { unlinkSync } from 'node:fs'; unlinkSync('dist/intermediate.txt');",
      );
      await write(
        `packages/${name}/dev.mjs`,
        'console.log(JSON.stringify({ marker: process.env.AGENTCTL_DEV_PROBE, cursor: process.env.XCURSOR_THEME }));',
      );
    }
    const run = (args, env = {}) =>
      execute(process.execPath, [cli, 'run', ...args], {
        cwd: root,
        env: { ...childEnv, ...env },
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    const build = () => run(['--filter', '@fixture/app', 'build']);
    const count = async (name) =>
      (await readFile(join(root, `packages/${name}/runs.log`), 'utf8')).trim().split('\n').length;
    const artifact = () => readFile(join(root, 'packages/app/dist/value.txt'), 'utf8');

    await write('packages/app/fixtures/value.txt', 'fixture-a');
    await build();
    assert.equal(await artifact(), 'dep-a+app-a');
    await build();
    assert.equal(await count('app'), 1);
    assert.equal(await count('dep'), 1);
    await rm(join(root, 'packages/app/dist'), { recursive: true });
    await build();
    assert.equal(await artifact(), 'dep-a+app-a');
    assert.equal(await count('app'), 1);
    await assert.rejects(readFile(join(root, 'packages/app/dist/intermediate.txt')), {
      code: 'ENOENT',
    });

    await write('packages/dep/src/value.txt', 'dep-b');
    await build();
    assert.equal(await artifact(), 'dep-b+app-a');
    assert.equal(await count('app'), 2);
    assert.equal(await count('dep'), 2);
    await write('packages/dep/src/added.ts', 'export const added = true;');
    await build();
    assert.equal(await count('app'), 3);
    assert.equal(await count('dep'), 3);
    await write('packages/styles/src/added.css', '.new-component { color: red; }');
    await build();
    assert.equal(await count('app'), 4);
    assert.equal(await count('renderer'), 2);
    assert.equal(await count('dep'), 3);
    await write('packages/unrelated/src/value.txt', 'unrelated-b');
    await build();
    assert.equal(await count('app'), 4);

    // Compiled fixtures outside src must invalidate their owner's output, without rebuilding deps.
    await write('packages/app/fixtures/value.txt', 'fixture-b');
    await build();
    assert.equal(await count('app'), 5);
    assert.equal(await count('dep'), 3);
    assert.equal(await count('renderer'), 2);
    await build();
    assert.equal(await count('app'), 5);

    const dev = await run(['--parallel', '--filter', '@fixture/app', 'dev'], {
      AGENTCTL_DEV_PROBE: 'preserved',
      XCURSOR_THEME: 'fixture-cursor',
    });
    assert.match(dev.stdout, /"marker":"preserved"/);
    assert.match(dev.stdout, /"cursor":"fixture-cursor"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
