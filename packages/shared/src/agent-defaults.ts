export const DEFAULT_AGENT_MODEL = 'default';

/** Effort IDs belong to the provider, including unfamiliar future values. */
export function isThinkingEffort(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
