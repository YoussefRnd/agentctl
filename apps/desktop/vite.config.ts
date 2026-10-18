import { defineConfig } from 'vite-plus';
import { createWorkspaceTasks } from '../../scripts/workspace-tasks.mjs';

const run = createWorkspaceTasks(import.meta.dirname, {
  build: 'electron-vite build',
  dev: 'pnpm exec install-electron && electron-vite dev',
  typecheck: 'tsc -b --noEmit',
  buildDependencies: ['@agentctl/web#compile', 'electron-runtime'],
  inputs: ['packages/core/drizzle/**'],
  outputs: ['out/**', 'drizzle/**'],
});

export default defineConfig({
  run: {
    tasks: {
      ...run.tasks,
      // Runtime binaries live in node_modules, outside the compiled artifact cache.
      'electron-runtime': { command: 'pnpm exec install-electron', cache: false },
    },
  },
});
