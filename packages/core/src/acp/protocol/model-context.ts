/** Preserve an explicitly supplied model window without inventing provider-specific defaults. */
export function modelContextMetadata(option: unknown): { contextWindow?: number } {
  if (!option || typeof option !== 'object') return {};
  const record = option as { contextWindow?: unknown; _meta?: { contextWindow?: unknown } | null };
  const value = record.contextWindow ?? record._meta?.contextWindow;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? { contextWindow: value }
    : {};
}
