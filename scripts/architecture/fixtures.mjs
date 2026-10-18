import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { packageRoots } from './dependency-config.mjs';

export const workspace = resolve(import.meta.dirname, '../..');
const execute = promisify(execFile);
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
export const run = (file, args, options = {}) =>
  execute(file, args, {
    env: childEnv,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });

export async function fixture(check) {
  const root = await mkdtemp(join(tmpdir(), 'agentctl-architecture-'));
  const write = async (file, value) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const publicApi = { packages: [], features: [] };
  try {
    const manifest = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'));
    const toolchain = JSON.parse(
      await readFile(join(workspace, 'node_modules/vite-plus/package.json'), 'utf8'),
    );
    await write('package.json', {
      name: 'architecture-fixture',
      private: true,
      type: 'module',
      packageManager: manifest.packageManager,
      devDependencies: { 'vite-plus': toolchain.version },
    });
    await write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');
    await mkdir(join(root, 'node_modules'));
    await symlink(
      join(workspace, 'node_modules/vite-plus'),
      join(root, 'node_modules/vite-plus'),
      'dir',
    );
    for (const [name, directory] of Object.entries(packageRoots)) {
      await write(`${directory}/package.json`, {
        name,
        type: 'module',
        exports: { '.': './src/index.ts' },
      });
      await write(`${directory}/src/index.ts`, 'export const value = 1;');
      if (!['@agentctl/web', '@agentctl/desktop'].includes(name))
        publicApi.packages.push({ package: name, root: directory, entries: ['.'] });
    }
    await write('docs/public-api.json', publicApi);
    await check({ root, write, publicApi });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function dependencies(root) {
  let output;
  let exitCode = 0;
  try {
    output = (
      await run(process.execPath, [
        join(workspace, 'scripts/check-dependencies.mjs'),
        '--root',
        root,
        '--json',
      ])
    ).stdout;
  } catch (error) {
    if (error.code !== 1 || !error.stdout) throw error;
    output = error.stdout;
    exitCode = 1;
  }
  return { ...JSON.parse(output), exitCode };
}
