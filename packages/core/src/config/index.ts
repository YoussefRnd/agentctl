import { parseServerEnv } from '@agentctl/shared';
import { loadWorkspaceEnv } from './workspace.js';

export const Config = {
  load() {
    loadWorkspaceEnv();
    return parseServerEnv(process.env);
  },
};
