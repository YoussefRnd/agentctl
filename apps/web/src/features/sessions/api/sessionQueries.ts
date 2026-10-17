import { sessionKeys } from '@/shared/lib/queryKeys';
import { queryOptions } from '@tanstack/react-query';
import { apiClient } from '@agentctl/api-client';
import type { SessionWithCapabilities } from '@agentctl/shared';

export const sessionQueries = {
  detail: (sessionId: string) =>
    queryOptions({
      queryKey: sessionKeys.detail(sessionId),
      queryFn: () => apiClient.fetch<SessionWithCapabilities>(`/api/sessions/${sessionId}`),
      enabled: Boolean(sessionId),
    }),
};
