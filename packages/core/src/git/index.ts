export * from './mutex.js';
export * from './worktree-manager.js';
export { SessionWorkspace, WorkspaceUnavailableError } from './session-workspace.js';
export type {
  EstablishOptions,
  TransitionOptions,
  WorkspaceContext,
  WorkspaceTargetState,
  FinalizeResolution,
} from './session-workspace.js';
export * from './snapshot-service.js';
export * from './utils.js';

export * from './repository-context.js';
export * from './repository-backend.js';
export * from './text-generation-context.js';
export * from './text-generation-settings.js';

export { createGitCapabilities, type GitCapabilities } from './composition.js';
export type * from './capabilities/ports.js';

export { legacyGitRevision } from './legacy-revisions.js';
