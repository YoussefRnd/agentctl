import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { parseEnv } from '@agentctl/shared';

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return startDir;
}

export const Config = {
  load() {
    const root = findWorkspaceRoot(process.cwd());
    const envPath = path.join(root, '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
    return parseEnv(process.env);
  }
};
