import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@agentctl/api-client';
import { sessionTurnIndexSchema } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

export function useSessionTurnIndex(sessionId: string) {
  return useQuery({
    queryKey: sessionKeys.turnIndex(sessionId),
    queryFn: async () =>
      sessionTurnIndexSchema.parse(
        await apiClient.fetch(`/api/sessions/${sessionId}/events/turns`),
      ),
    enabled: Boolean(sessionId),
    staleTime: Infinity,
  });
}
