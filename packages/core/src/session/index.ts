// Deliberate application entry points. Workflow implementations stay internal.
export { SessionManager, resolveAgentSessionId } from './manager.js';
export type { CreateSessionParams, IEventBus } from './manager.js';
export { readSessionExecutionState } from './execution/session-execution-state.js';
// Event persistence is shared with server import/replay integrations and their fixtures.
export {
  SessionEventRepository,
  SESSION_CHANGE_RETENTION,
} from './persistence/session-event-repository.js';
