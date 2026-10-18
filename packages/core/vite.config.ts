import { defineConfig } from 'vite-plus';
import { createWorkspaceTasks } from '../../scripts/workspace-tasks.mjs';

export default defineConfig({
  run: createWorkspaceTasks(import.meta.dirname, {
    build: 'node ../../scripts/run-build-steps.mjs tsc -b -- node scripts/copy-skills.mjs',
    dev: 'tsc -b --watch',
    typecheck: 'tsc --noEmit',
  }),
});
