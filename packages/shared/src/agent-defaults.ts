export const DEFAULT_AGENT_MODEL = 'default';
export const THINKING_EFFORTS = ['low', 'medium', 'high'] as const;
export const DEFAULT_THINKING_EFFORT: (typeof THINKING_EFFORTS)[number] = 'medium';

export function isThinkingEffort(value: unknown): value is (typeof THINKING_EFFORTS)[number] {
  return THINKING_EFFORTS.some((effort) => effort === value);
}
