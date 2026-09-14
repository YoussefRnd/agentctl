import { projectsContract } from './contracts/projects.contract.js';
import { sessionsContract } from './contracts/sessions.contract.js';
import { providersContract } from './contracts/providers.contract.js';
import { searchContract } from './contracts/search.contract.js';
import { mcpContract } from './contracts/mcp.contract.js';
import { settingsContract } from './contracts/settings.contract.js';
import { diagnosticsContract } from './contracts/diagnostics.contract.js';

export * from './contracts/projects.contract.js';
export * from './contracts/sessions.contract.js';
export * from './contracts/providers.contract.js';
export * from './contracts/search.contract.js';
export * from './contracts/mcp.contract.js';
export * from './contracts/settings.contract.js';
export * from './contracts/diagnostics.contract.js';

export const apiContract = {
  ...searchContract,
  ...projectsContract,
  ...providersContract,
  ...sessionsContract,
  ...settingsContract,
  ...mcpContract,
  ...diagnosticsContract,
} as const;
