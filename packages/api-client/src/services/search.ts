import type { SearchEventType } from '@agentctl/shared';
import { api } from '../api.js';
import { assertApiStatus } from '../api-error.js';

export type { SearchResultItem } from '@agentctl/shared';

export async function searchSessionEvents(params: {
  q: string;
  type?: 'all' | SearchEventType;
  projectId?: string;
  sessionId?: string;
  limit?: number;
}): Promise<import('@agentctl/shared').SearchResultItem[]> {
  const res = await api.searchEvents({
    query: {
      q: params.q,
      ...(params.type ? { type: params.type } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  });
  assertApiStatus(res, 200, 'Failed to search events');
  return res.body;
}
