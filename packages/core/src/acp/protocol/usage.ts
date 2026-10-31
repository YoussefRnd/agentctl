import type { AgentUsage } from '../../agent/types.js';
import { normalizeReportedCost } from '@agentctl/shared';

function count(raw: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return undefined;
}

/** Normalizes usage variants observed from ACP v1 peers into the product model. */
export function normalizeAcpUsage(usage: unknown): AgentUsage | undefined {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const raw = usage as Record<string, unknown>;

  return {
    inputTokens: count(raw, 'inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'),
    outputTokens: count(
      raw,
      'outputTokens',
      'output_tokens',
      'completionTokens',
      'completion_tokens',
    ),
    totalTokens: count(raw, 'totalTokens', 'total_tokens', 'used', 'usedTokens'),
    thoughtTokens: count(raw, 'thoughtTokens', 'thought_tokens'),
    cachedReadTokens: count(raw, 'cachedReadTokens', 'cached_read_tokens'),
    cachedWriteTokens: count(raw, 'cachedWriteTokens', 'cached_write_tokens'),
    contextLimit: count(raw, 'contextLimit', 'context_limit', 'size', 'maxTokens'),
    cost: normalizeReportedCost(raw.cost),
  };
}
