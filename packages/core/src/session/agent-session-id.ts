import { jsonCodecs } from '../db/json-codecs.js';

export function resolveAgentSessionId(
  rawAgentSessionId: string | null | undefined,
  targetProviderId: string,
  initialProviderId?: string | null,
): string | null {
  if (!rawAgentSessionId) return null;
  const parsed = jsonCodecs.agentSessionMap(rawAgentSessionId);
  if (parsed) return parsed[targetProviderId] ?? null;
  if (!initialProviderId || initialProviderId === targetProviderId) {
    return rawAgentSessionId;
  }
  return null;
}
