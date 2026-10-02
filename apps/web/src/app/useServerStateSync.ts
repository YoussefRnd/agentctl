import { invalidateWorkspaceQueries } from '@/shared/lib/workspaceQueries';
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getApiBaseUrl, getDesktopCapability } from '@agentctl/api-client';
import {
  stateChangeEventSchema,
  type StateChangeEvent,
  type StateChangeTopic,
} from '@agentctl/shared';
import {
  mcpKeys,
  projectKeys,
  providerKeys,
  sessionKeys,
  settingsKeys,
} from '@/shared/lib/queryKeys';

const ALL_TOPICS: StateChangeTopic[] = [
  'projects',
  'providers',
  'session',
  'workspace',
  'mcp',
  'settings',
];

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
    void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
  }
  if (topics.has('settings')) {
    void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
  }
}

function processSseBlock(block: string, queryClient: QueryClient): void {
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (eventName === 'state_ready') {
    applyStateChange(queryClient, {
      sequence: 0,
      topics: ALL_TOPICS,
      occurredAt: new Date().toISOString(),
    });
    return;
  }
  if (eventName !== 'state_change' || dataLines.length === 0) return;

  try {
    const parsed = stateChangeEventSchema.safeParse(JSON.parse(dataLines.join('\n')));
    if (parsed.success) applyStateChange(queryClient, parsed.data);
  } catch {
    // Ignore malformed events. Reconnect reconciliation repairs missed state.
  }
}

export function useServerStateSync(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let finishReconnectWait: (() => void) | null = null;

    const connect = async () => {
      while (active) {
        controller = new AbortController();
        try {
          const headers: Record<string, string> = { Accept: 'text/event-stream' };
          const capability = getDesktopCapability();
          if (capability) headers.Authorization = `Bearer ${capability}`;

          const response = await fetch(`${getApiBaseUrl()}/api/events/stream`, {
            headers,
            credentials: 'include',
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`State stream failed: ${String(response.status)}`);
          const reader = response.body?.getReader();
          if (!reader) throw new Error('State stream response has no body');

          const decoder = new TextDecoder();
          let buffer = '';
          while (active) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replaceAll('\r\n', '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              processSseBlock(buffer.slice(0, boundary), queryClient);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch (error) {
          if (!active || (error instanceof Error && error.name === 'AbortError')) return;
        }

        if (active) {
          await new Promise<void>((resolve) => {
            finishReconnectWait = resolve;
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              finishReconnectWait = null;
              resolve();
            }, 2_000);
          });
        }
      }
    };

    void connect();
    return () => {
      active = false;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      finishReconnectWait?.();
    };
  }, [queryClient]);
}
