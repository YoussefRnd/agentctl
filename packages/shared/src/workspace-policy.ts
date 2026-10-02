import type { SessionStatus } from './schemas/session.js';

/** Git mutations and finalization require a stopped, editable session. */
export function canMutateWorkspace(status: SessionStatus | null | undefined): boolean {
  return status === 'idle' || status === 'error';
}
