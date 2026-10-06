import type { AgentPermissionRequest } from '../agent/types.js';

/**
 * Automatic decisions only select a once option. Persistent choices require
 * an explicit user selection; absent a once option, the caller asks or cancels.
 */
export function getBestPermissionOption(
  options?: AgentPermissionRequest['options'],
  decision: 'allow' | 'reject' = 'allow',
): string | undefined {
  if (!options || options.length === 0) return undefined;

  const kind = decision === 'allow' ? 'allow_once' : 'reject_once';
  return (
    options.find((option) => option.kind === kind) ??
    options.find((option) => !option.kind && option.optionId.replaceAll('-', '_') === kind)
  )?.optionId;
}

/**
 * Whether an option id signals a persistent grant (patterns should be stored).
 * Agent-native ids vary: allow_always, allow-always, allow_session, allow forever, ...
 */
export function isPersistentPermissionOption(optionId: string | undefined): boolean {
  if (!optionId) return false;
  const id = optionId.toLowerCase();
  return (
    id.includes('always') ||
    id.includes('session') ||
    id.includes('forever') ||
    id.includes('permanent')
  );
}
