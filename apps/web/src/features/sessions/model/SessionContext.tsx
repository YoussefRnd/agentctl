/** Compatibility entry point; focused providers own configuration and streaming separately. */
export { SessionConfigProvider, useSession, type StructuredPlanItem } from './SessionConfigContext';
export {
  SessionStreamProvider,
  useSessionStream,
  useSessionQueue,
  useSessionResponseState,
  useSessionExecution,
  useSessionPromptEvents,
} from './SessionStreamContext';
export type { QueuedMessage } from '@/shared';
