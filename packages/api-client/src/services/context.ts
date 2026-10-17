import { apiClient } from '../api-client.js';

import type {
  ContextItemType,
  ContextItem,
  ContextItemReference,
  ResolvedContextResult,
} from '@agentctl/shared';
export type {
  ContextItemType,
  ContextItem,
  ContextItemReference,
  ResolvedContextResult,
} from '@agentctl/shared';
export async function searchContext(
  sessionId: string,
  query = '',
  type: 'all' | ContextItemType = 'all',
  scope: 'sessions' | 'projects' = 'sessions',
  signal?: AbortSignal,
): Promise<ContextItem[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (type !== 'all') params.set('type', type);

  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await apiClient.fetch<{ items: ContextItem[] }>(
    `/api/${scope}/${sessionId}/context/search${qs}`,
    { signal },
  );
  return response.items;
}

export async function resolveContext(
  sessionId: string,
  items: ContextItemReference[],
  scope: 'sessions' | 'projects' = 'sessions',
): Promise<ResolvedContextResult> {
  const response = await apiClient.fetch<ResolvedContextResult>(
    `/api/${scope}/${sessionId}/context/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({ items }),
    },
  );
  return response;
}
