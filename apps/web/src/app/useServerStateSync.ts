import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { subscribeStateChanges } from '@agentctl/api-client';
import { type StateChangeEvent } from '@agentctl/shared';
import {
  mcpKeys,
  projectKeys,
  providerKeys,
  sessionKeys,
  settingsKeys,
} from '@/shared/lib/queryKeys';

export function applyStateChange(queryClient: QueryClient, event: StateChangeEvent): void {
  const topics = new Set(event.topics);

  if (topics.has('projects')) {
    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
  }
  if (topics.has('providers')) {
    void queryClient.invalidateQueries({ queryKey: providerKeys.all });
    void queryClient.invalidateQueries({ queryKey: providerKeys.registry });
  }
  if (topics.has('session')) {
    void queryClient.invalidateQueries({
      queryKey: event.sessionId ? sessionKeys.detail(event.sessionId) : sessionKeys.all,
    });
  }
  if (topics.has('workspace')) invalidateWorkspaceQueries(queryClient, event.sessionId);
  if (topics.has('mcp')) {
    void queryClient.invalidateQueries({ queryKey: mcpKeys.all });
    void queryClient.invalidateQueries({ queryKey: mcpKeys.tools });
  }
  if (topics.has('settings')) {
    void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
  }
}

export function useServerStateSync(): void {
  const queryClient = useQueryClient();
  useEffect(
    () => subscribeStateChanges((event) => applyStateChange(queryClient, event)),
    [queryClient],
  );
}
