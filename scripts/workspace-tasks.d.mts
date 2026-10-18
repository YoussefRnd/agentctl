import type { ViteUserConfig } from 'vite-plus';

interface WorkspaceCommands {
  build: string;
  typecheck: string;
  dev: string;
  buildDependencies?: string[];
  inputs?: string[];
  outputs?: string[];
}

export function createWorkspaceTasks(
  packageRoot: string,
  commands: WorkspaceCommands,
): NonNullable<ViteUserConfig['run']>;
