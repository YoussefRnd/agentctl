import { apiClient } from '../api-client.js';

export type ContextItemType = 'file' | 'folder' | 'git' | 'symbol';

export interface ContextItem {
  id: string;
  type: ContextItemType;
  title: string;
  subtitle: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface ContextItemReference {
  type: ContextItemType;
  value: string;
  path?: string;
  target?: string;
}

export interface ResolvedContextResult {
  formattedContent: string;
  items: Array<{
    id: string;
    type: ContextItemType;
    title: string;
    size: number;
  }>;
}

export async function searchContext(
  sessionId: string,
  query = '',
  type: 'all' | ContextItemType = 'all',
  scope: 'sessions' | 'projects' = 'sessions',
): Promise<ContextItem[]> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (type !== 'all') params.set('type', type);

  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await apiClient.fetch<{ items: ContextItem[] }>(
    `/api/${scope}/${sessionId}/context/search${qs}`,
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
