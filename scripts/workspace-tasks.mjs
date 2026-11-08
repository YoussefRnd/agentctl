import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const workspace = resolve(import.meta.dirname, '..');
const packages = new Map();
const packagesByRoot = new Map();
for (const group of ['apps', 'packages']) {
  for (const entry of readdirSync(join(workspace, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(workspace, group, entry.name);
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const entry = { root, manifest };
      packages.set(manifest.name, entry);
      packagesByRoot.set(root, entry);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

// Explicit source inputs also cover native TypeScript compilers that bypass file tracing.
function dependencyInputs({ root, manifest }, visited) {
  const { name } = manifest;
  if (visited.has(name)) return [];
  visited.add(name);
  const directory = relative(workspace, root).replaceAll('\\', '/');
  const inputs = [
    'src/**',
    'public/**',
    'scripts/**',
    '.env*',
    '*.{ts,tsx,mts,cts,js,mjs,cjs,json,html,css}',
  ].map((pattern) => ({
    pattern: `${directory}/${pattern}`,
    base: 'workspace',
  }));
  for (const dependency of Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    const target = packages.get(dependency);
    if (target) inputs.push(...dependencyInputs(target, visited));
  }
  return inputs;
}

export function createWorkspaceTasks(packageRoot, commands) {
  const dependencies = { task: 'compile', from: ['dependencies', 'devDependencies'] };
  const visited = new Set();
  const entry = packagesByRoot.get(resolve(packageRoot));
  if (!entry) throw new Error(`Unknown workspace package: ${packageRoot}`);
  const sourceInputs = dependencyInputs(entry, visited);
  // Explicit workspace prerequisites can consume sources outside manifest dependencies
  // (the desktop renderer uses the web app and its UI/API-client dependencies).
  for (const task of commands.buildDependencies ?? []) {
    const dependency = packages.get(task.slice(0, task.lastIndexOf('#')));
    if (dependency) sourceInputs.push(...dependencyInputs(dependency, visited));
  }
  return {
    tasks: {
      compile: {
        command: commands.build,
        dependsOn: [dependencies, ...(commands.buildDependencies ?? [])],
        cache: {
          env: ['NODE_ENV', 'VITE_*'],
          input: [
            // Read only sources: tracing generated directory reads would invalidate
            // the cache when its output is deleted instead of restoring that output.
            ...sourceInputs,
            ...[
              'tsconfig.json',
              'packages/tsconfig/**',
              'vite.config.ts',
              'scripts/workspace-tasks.*',
              'scripts/run-build-steps.mjs',
              'pnpm-workspace.yaml',
              'pnpm-lock.yaml',
              '.env*',
              ...(commands.inputs ?? []),
            ].map((pattern) => ({ pattern, base: 'workspace' })),
          ],
          // Archive all declared artifacts, including an incremental compiler's existing output.
          output: commands.outputs ?? ['dist/**', '*.tsbuildinfo'],
        },
      },
      types: {
        command: commands.typecheck,
        dependsOn: [dependencies],
        cache: false,
      },
      watch: {
        command: commands.dev,
        cache: false,
      },
    },
  };
}
