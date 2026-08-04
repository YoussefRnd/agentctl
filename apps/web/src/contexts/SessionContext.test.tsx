// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sessionStore } from '@agentctl/shared';
import type { ACPEventRow, SessionWithCapabilities } from '@agentctl/shared';

vi.mock('@agentctl/api-client', () => ({
  api: { sendInput: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../hooks/useSessionEvents', () => ({
  useSessionEvents: () => ({
    events: [],
    isLoading: false,
    isConnected: true,
    streamingEventId: null,
    refetch: vi.fn(),
  }),
}));

import { api } from '@agentctl/api-client';
import { toast } from 'sonner';
import { SessionStreamProvider, useSessionStream } from './SessionContext';

const mockedSendInput = vi.mocked(api.sendInput);
const mockedToastError = vi.mocked(toast.error);

function Harness() {
  const { enqueueMessage } = useSessionStream();
  return (
    <button
      type="button"
      onClick={() => {
        enqueueMessage('hello world');
      }}
    >
      enqueue
    </button>
  );
}

function ghostEvent(content = 'hello world'): ACPEventRow {
  return {
    id: -1,
    sessionId: 'sess-1',
    type: 'text',
    data: { role: 'user', content },
    createdAt: new Date(),
  };
}

function makeSession(status: 'idle' | 'running'): SessionWithCapabilities {
  return {
    session: {
      id: 'sess-1',
      status,
      title: 'Test',
      mode: 'local',
      branch: 'main',
      project: null,
      selectedProvider: null,
      selectedModel: null,
      approvalMode: 'review',
      persona: 'default',
      totalTokens: 0,
      contextLimit: 0,
      sessionMetrics: {},
    },
    capabilities: [],
  } as unknown as SessionWithCapabilities;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  document.body.innerHTML = '';
  vi.clearAllMocks();
  sessionStore.setSession(null);
});

describe('SessionStreamProvider queued message send', () => {
  it('toasts an error and removes the ghost message when a queued send fails', async () => {
    sessionStore.setSession(makeSession('idle'));
    queryClient.setQueryData(['events', 'sess-1'], [ghostEvent()]);
    mockedSendInput.mockRejectedValueOnce(new Error('boom'));

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Harness />
          </SessionStreamProvider>
        </QueryClientProvider>,
      );
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button')?.click();
    });

    await vi.waitFor(() => {
      expect(mockedSendInput).toHaveBeenCalledTimes(1);
    });
    expect(mockedSendInput).toHaveBeenCalledWith({
      params: { id: 'sess-1' },
      body: { input: 'hello world' },
    });

    await vi.waitFor(() => {
      expect(mockedToastError).toHaveBeenCalled();
    });

    const remaining = queryClient.getQueryData<ACPEventRow[]>(['events', 'sess-1']) ?? [];
    expect(remaining.some((e) => e.id < 0)).toBe(false);
  });

  it('sends a queued message successfully when the session is idle', async () => {
    sessionStore.setSession(makeSession('idle'));
    mockedSendInput.mockResolvedValueOnce({
      status: 200,
      body: { success: true },
      headers: new Headers(),
    } as never);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Harness />
          </SessionStreamProvider>
        </QueryClientProvider>,
      );
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button')?.click();
    });

    await vi.waitFor(() => {
      expect(mockedSendInput).toHaveBeenCalledTimes(1);
    });
    expect(mockedToastError).not.toHaveBeenCalled();
  });
});
