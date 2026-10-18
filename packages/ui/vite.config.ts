import { defineConfig } from 'vite-plus';
import { createWorkspaceTasks } from '../../scripts/workspace-tasks.mjs';

export default defineConfig({
  run: createWorkspaceTasks(import.meta.dirname, {
    build: 'tsc -b',
    dev: 'tsc -b --watch',
    typecheck: 'tsc --noEmit',
  }),
});
