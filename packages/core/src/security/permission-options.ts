import type { AgentPermissionRequest } from '../agent/types.js';

/**
 * Picks an allow-once or reject-once option from the agent-advertised options.
 * Persistent choices are a fallback and must only be preferred after an
 * explicit user selection.
 */
export function getBestPermissionOption(
  options?: AgentPermissionRequest['options'],
  decision: 'allow' | 'reject' = 'allow',
): string | undefined {
  if (!options || options.length === 0) return undefined;

  const preferredKinds =
    decision === 'allow'
      ? (['allow_once', 'allow_always'] as const)
      : (['reject_once', 'reject_always'] as const);
  for (const kind of preferredKinds) {
    const byKind = options.find((option) => option.kind === kind);
    if (byKind) return byKind.optionId;
  }

  const keywords =
    decision === 'allow'
      ? ['allow', 'approve', 'yes', 'grant', 'confirm', 'ok']
      : ['deny', 'reject', 'block', 'no'];
  const byLabel = options.find((option) => {
    const text = `${option.optionId} ${option.label ?? ''}`.toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
  return byLabel?.optionId;
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
