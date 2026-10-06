export { DEFAULT_AGENT_MODEL, DEFAULT_THINKING_EFFORT } from '@agentctl/shared';

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const DEFAULT_CONTEXT_LIMIT = 0;
export const DEFAULT_CONTEXT_TURN_LIMIT = 10;
export const DEFAULT_HANDOFF_RETENTION_MS = 10 * 60 * 1000;
export const DEFAULT_STALE_HANDOFF_AGE_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AGENT_REQUEST_TIMEOUT_MS = 60_000;
export const DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS = 120_000;
export const DEFAULT_PROVIDER_AUTH_TIMEOUT_MS = 120_000;
export const DEFAULT_TERMINAL_AUTH_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 3_000;
export const DEFAULT_GIT_MAX_BUFFER_BYTES = 256 * 1024;

export const getContextTurnLimit = () =>
  positiveIntegerFromEnv('AGENTCTL_CONTEXT_TURN_LIMIT', DEFAULT_CONTEXT_TURN_LIMIT);
export const getHandoffRetentionMs = () =>
  positiveIntegerFromEnv('AGENTCTL_HANDOFF_RETENTION_MS', DEFAULT_HANDOFF_RETENTION_MS);
export const getStaleHandoffAgeMs = () =>
  positiveIntegerFromEnv('AGENTCTL_STALE_HANDOFF_AGE_MS', DEFAULT_STALE_HANDOFF_AGE_MS);
export const getAgentRequestTimeoutMs = () =>
  positiveIntegerFromEnv('AGENTCTL_AGENT_REQUEST_TIMEOUT_MS', DEFAULT_AGENT_REQUEST_TIMEOUT_MS);
export const getGitCommandTimeoutMs = () =>
  positiveIntegerFromEnv('AGENTCTL_GIT_COMMAND_TIMEOUT_MS', DEFAULT_GIT_COMMAND_TIMEOUT_MS);
export const getGitMaxBufferBytes = () =>
  positiveIntegerFromEnv('AGENTCTL_GIT_MAX_BUFFER_BYTES', DEFAULT_GIT_MAX_BUFFER_BYTES);
