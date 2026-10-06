import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(current, '.git'))
    )
      return current;
    current = path.dirname(current);
  }
  return startDir;
}

export function loadWorkspaceEnv(startDir = process.cwd()): string {
  const root = findWorkspaceRoot(startDir);
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  return root;
}
