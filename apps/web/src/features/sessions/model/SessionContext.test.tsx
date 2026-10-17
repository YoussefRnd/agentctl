// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';
import { sessionKeys, useMessageQueueStore } from '@/shared';

vi.mock('@agentctl/api-client', () => ({
  api: { sendInput: vi.fn(), resumeSessionQueue: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { streamState } = vi.hoisted(() => ({ streamState: { events: [] as SessionEventRow[] } }));

vi.mock('./useSessionEvents', () => ({
  useSessionEvents: () => ({
    events: streamState.events,
    isLoading: false,
    isConnected: true,
    streamingEventId: null,
    refetch: vi.fn(),
  }),
}));

import { api } from '@agentctl/api-client';
import { toast } from 'sonner';
import {
  SessionStreamProvider,
  useSessionStream,
  useSessionQueue,
  useSessionPromptEvents,
  useSessionResponseState,
} from './SessionStreamContext';

const mockedSendInput = vi.mocked(api.sendInput);
const mockedToastError = vi.mocked(toast.error);

function Harness({ optimisticEventId }: { optimisticEventId?: number }) {
  const { enqueueMessage } = useSessionStream();
  return (
    <button
      type="button"
      onClick={() => {
        enqueueMessage('hello world', undefined, optimisticEventId);
      }}
    >
      enqueue
    </button>
  );
}

function ghostEvent(content = 'hello world'): Extract<SessionEventRow, { type: 'text' }> {
  return {
    id: -1,
    sessionId: 'sess-1',
    type: 'text',
    data: { role: 'user', content },
    createdAt: new Date(),
  };
}

function makeSession(status: 'idle' | 'running' | 'error'): SessionWithCapabilities {
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
  streamState.events = [];
  mockedSendInput.mockReset();
  vi.mocked(api.resumeSessionQueue).mockReset();
  useMessageQueueStore.getState().clearQueue();
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
  useMessageQueueStore.getState().clearQueue();
});

describe('SessionStreamProvider queued message send', () => {
  it('rejects stale retry callbacks for uncertain local outbox delivery', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    useMessageQueueStore
      .getState()
      .enqueueMessage('sess-1', 'uncertain prompt', [], -1, 'uncertain', 'unknown');
    function Retry() {
      const queue = useSessionQueue();
      return (
        <>
          <button onClick={() => queue.retryQueuedMessage('uncertain')}>retry queue</button>
          <button onClick={() => queue.retryMessage(-1)}>retry message</button>
        </>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Retry />
          </SessionStreamProvider>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      for (const button of container.querySelectorAll<HTMLButtonElement>('button')) button.click();
    });
    expect(mockedSendInput).not.toHaveBeenCalled();
    expect(useMessageQueueStore.getState().queuedMessages['sess-1'][0].status).toBe('unknown');
  });

  it.each(['unknown', 'contradictory-policy'] as const)(
    'does not replay a persisted message with %s delivery',
    async (kind) => {
      const event = {
        ...ghostEvent(),
        id: 7,
        data: {
          ...ghostEvent().data,
          deliveryStatus: kind === 'unknown' ? ('unknown' as const) : ('failed' as const),
          ...(kind === 'contradictory-policy'
            ? {
                deliveryFailure: {
                  version: 1 as const,
                  id: 'failure',
                  category: 'connection' as const,
                  scope: 'attempt' as const,
                  stage: 'dispatch' as const,
                  delivery: 'unknown' as const,
                  message: 'Connection interrupted',
                  actions: ['retry' as const],
                },
              }
            : {}),
        },
      };
      queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('error'));
      queryClient.setQueryData(sessionKeys.events('sess-1'), [event]);
      function Retry() {
        const queue = useSessionQueue();
        return <button onClick={() => queue.retryMessage(7)}>retry</button>;
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <SessionStreamProvider sessionId="sess-1">
              <Retry />
            </SessionStreamProvider>
          </QueryClientProvider>,
        ),
      );
      await act(async () => container.querySelector('button')!.click());
      expect(api.resumeSessionQueue).not.toHaveBeenCalled();
      expect(mockedSendInput).not.toHaveBeenCalled();
      expect(useMessageQueueStore.getState().queuedMessages['sess-1'] ?? []).toEqual([]);
    },
  );

  it('retries a persisted rejection with a new receipt only after explicitly resuming', async () => {
    const event = {
      ...ghostEvent(),
      id: 7,
      data: {
        ...ghostEvent().data,
        deliveryStatus: 'failed' as const,
        clientMessageId: 'rejected-receipt',
        attachmentIds: ['image'],
      },
    };
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('error'));
    queryClient.setQueryData(sessionKeys.events('sess-1'), [event]);
    vi.mocked(api.resumeSessionQueue).mockImplementation(async () => {
      queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
      return { status: 200, body: { success: true }, headers: new Headers() } as never;
    });
    mockedSendInput.mockResolvedValue({
      status: 200,
      body: { success: true, eventId: 8 },
      headers: new Headers(),
    } as never);
    function Retry() {
      const queue = useSessionQueue();
      return <button onClick={() => queue.retryMessage(7)}>retry</button>;
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Retry />
          </SessionStreamProvider>
        </QueryClientProvider>,
      ),
    );
    expect(mockedSendInput).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button')!.click());
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledOnce());
    expect(api.resumeSessionQueue).toHaveBeenCalledOnce();
    const body = mockedSendInput.mock.calls[0][0].body;
    expect(body).toMatchObject({ input: 'hello world', attachmentIds: ['image'] });
    expect(body.clientMessageId).not.toBe('rejected-receipt');
  });

  it('keeps an accepted queued message successful when its HTTP acknowledgment is lost', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    let reject!: (error: Error) => void;
    mockedSendInput.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }) as never,
    );
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Harness optimisticEventId={-1} />
          </SessionStreamProvider>
        </QueryClientProvider>,
      ),
    );
    await act(async () => container.querySelector('button')!.click());
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledOnce());
    const receipt = useMessageQueueStore.getState().queuedMessages['sess-1'][0].id;
    await act(async () => {
      queryClient.setQueryData(sessionKeys.events('sess-1'), [
        {
          ...ghostEvent(),
          id: 7,
          data: {
            role: 'user',
            content: 'hello world',
            clientMessageId: receipt,
            deliveryStatus: 'queued',
          },
        },
      ]);
      reject(new Error('response lost'));
    });
    expect(useMessageQueueStore.getState().queuedMessages['sess-1']).toEqual([]);
    expect(mockedToastError).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<SessionEventRow[]>(sessionKeys.events('sess-1'))?.[0],
    ).toMatchObject({ id: 7, data: { deliveryStatus: 'queued' } });
  });
  it('continues with the next queued message when a failed head is cancelled', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    mockedSendInput
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 200, body: { eventId: 7 } } as never);
    let cancel!: (id: string) => void;
    function CancelHarness() {
      cancel = useSessionStream().dequeueMessage;
      return null;
    }
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <CancelHarness />
          </SessionStreamProvider>
        </QueryClientProvider>,
      ),
    );
    let failedId!: string;
    await act(async () => {
      failedId = useMessageQueueStore.getState().enqueueMessage('sess-1', 'first');
      useMessageQueueStore.getState().enqueueMessage('sess-1', 'second');
    });
    await vi.waitFor(() =>
      expect(useMessageQueueStore.getState().queuedMessages['sess-1'][0].status).toBe('failed'),
    );
    expect(mockedSendInput).toHaveBeenCalledTimes(1);
    await act(async () => {
      cancel(failedId);
    });
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(2));
    expect(mockedSendInput).toHaveBeenLastCalledWith({
      params: { id: 'sess-1' },
      body: { input: 'second', clientMessageId: expect.any(String) },
    });
  });
  it('marks a queued prompt as failed when the send is rejected', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    queryClient.setQueryData(sessionKeys.events('sess-1'), [ghostEvent()]);
    mockedSendInput.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      status: 200,
      body: { success: true, eventId: 7 },
      headers: new Headers(),
    } as never);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Harness optimisticEventId={-1} />
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
      body: { input: 'hello world', clientMessageId: expect.any(String) },
    });

    await vi.waitFor(() => {
      expect(mockedToastError).toHaveBeenCalled();
    });

    const remaining =
      queryClient.getQueryData<SessionEventRow[]>(sessionKeys.events('sess-1')) ?? [];
    const failed = remaining.find((event) => event.id === -1);
    expect(failed?.type === 'text' && failed.data.deliveryStatus).toBe('failed');
    expect(failed?.type === 'text' && failed.data.deliveryError).toBe('boom');

    act(() => {
      useMessageQueueStore.getState().enqueueMessage('sess-1', 'later');
      queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('error'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedSendInput).toHaveBeenCalledTimes(1);

    const toastOptions = mockedToastError.mock.calls[0]?.[1] as
      | {
          action?: { onClick?: () => void };
        }
      | undefined;
    await act(async () => {
      toastOptions?.action?.onClick?.();
    });
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(2));
    const retried = queryClient
      .getQueryData<SessionEventRow[]>(sessionKeys.events('sess-1'))
      ?.find((event) => event.id === 7);
    expect(retried?.type === 'text' && retried.data.deliveryStatus).toBe('queued');
    expect(
      queryClient
        .getQueryData<SessionEventRow[]>(sessionKeys.events('sess-1'))
        ?.some((event) => event.id === -1),
    ).toBe(false);
  });

  it('re-enqueues a failed message when retried while the session is running', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    queryClient.setQueryData(sessionKeys.events('sess-1'), [ghostEvent()]);
    mockedSendInput.mockRejectedValueOnce(new Error('boom'));

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">
            <Harness optimisticEventId={-1} />
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
    await vi.waitFor(() => {
      expect(mockedToastError).toHaveBeenCalled();
    });

    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('running'));

    const toastOptions = mockedToastError.mock.calls[0]?.[1] as
      | {
          action?: { onClick?: () => void };
        }
      | undefined;
    await act(async () => {
      toastOptions?.action?.onClick?.();
    });

    expect(mockedSendInput).toHaveBeenCalledTimes(1);

    const queue = useMessageQueueStore.getState().queuedMessages['sess-1'];
    expect(queue).toHaveLength(1);
    expect(queue?.[0]).toMatchObject({
      text: 'hello world',
      optimisticEventId: -1,
    });

    const event = queryClient
      .getQueryData<SessionEventRow[]>(sessionKeys.events('sess-1'))
      ?.find((e) => e.id === -1);
    expect(event?.type === 'text' && event.data.deliveryStatus).toBe('queued');
  });

  it('keeps queued prompts in their originating session', () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueueMessage('sess-1', 'first');
    queue.enqueueMessage('sess-2', 'second');

    expect(
      useMessageQueueStore.getState().queuedMessages['sess-1']?.map((msg) => msg.text),
    ).toEqual(['first']);
    expect(
      useMessageQueueStore.getState().queuedMessages['sess-2']?.map((msg) => msg.text),
    ).toEqual(['second']);

    queue.dequeueMessage('sess-1', useMessageQueueStore.getState().queuedMessages['sess-1'][0].id);
    expect(useMessageQueueStore.getState().queuedMessages['sess-2']).toHaveLength(1);
  });

  it('waits for the current turn before submitting the next queued prompt', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    mockedSendInput.mockResolvedValue({
      status: 200,
      body: { success: true, eventId: 7 },
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
      const queue = useMessageQueueStore.getState();
      queue.enqueueMessage('sess-1', 'first');
      queue.enqueueMessage('sess-1', 'second');
    });

    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(1));
    expect(mockedSendInput).toHaveBeenCalledWith({
      params: { id: 'sess-1' },
      body: { input: 'first', clientMessageId: expect.any(String) },
    });
    expect(useMessageQueueStore.getState().queuedMessages['sess-1']).toHaveLength(1);

    await act(async () => {
      queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('running'));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await act(async () => {
      queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    });
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(2));
    expect(mockedSendInput).toHaveBeenLastCalledWith({
      params: { id: 'sess-1' },
      body: { input: 'second', clientMessageId: expect.any(String) },
    });
  });

  it('submits the next queued prompt after a fast turn ends without a visible running state', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
    mockedSendInput.mockResolvedValue({
      status: 200,
      body: { success: true, eventId: 7 },
      headers: new Headers(),
    } as never);
    const render = () => (
      <QueryClientProvider client={queryClient}>
        <SessionStreamProvider sessionId="sess-1">
          <Harness />
        </SessionStreamProvider>
      </QueryClientProvider>
    );

    act(() => root.render(render()));
    act(() => {
      const queue = useMessageQueueStore.getState();
      queue.enqueueMessage('sess-1', 'first');
      queue.enqueueMessage('sess-1', 'second');
    });
    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(1));

    streamState.events = [
      {
        id: 20,
        sessionId: 'sess-1',
        type: 'status',
        data: { status: 'turn_end' },
        createdAt: new Date(),
      } as SessionEventRow,
    ];
    await act(async () => root.render(render()));

    await vi.waitFor(() => expect(mockedSendInput).toHaveBeenCalledTimes(2));
    expect(mockedSendInput).toHaveBeenLastCalledWith({
      params: { id: 'sess-1' },
      body: { input: 'second', clientMessageId: expect.any(String) },
    });
  });

  it('sends a queued message successfully when the session is idle', async () => {
    queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('idle'));
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

it('isolates queue, prompt, and progress subscribers from provider text while retaining semantic updates', async () => {
  queryClient.setQueryData(sessionKeys.detail('sess-1'), makeSession('running'));
  const user = {
    ...ghostEvent('first'),
    id: 1,
    data: { role: 'user' as const, content: 'first', deliveryStatus: 'accepted' as const },
  };
  let reply: SessionEventRow = {
    ...ghostEvent('reply'),
    id: 2,
    data: { role: 'provider', content: 'reply' },
  };
  streamState.events = [user, reply];
  const counts = { queue: 0, prompts: 0, turn: 0, stream: 0 };
  let promptEvents: SessionEventRow[] = [];
  let turn: ReturnType<typeof useSessionResponseState>['turn'] = null;
  function Queue() {
    useSessionQueue();
    counts.queue++;
    return null;
  }
  function Prompts() {
    promptEvents = useSessionPromptEvents();
    counts.prompts++;
    return null;
  }
  function Turn() {
    turn = useSessionResponseState().turn;
    counts.turn++;
    return null;
  }
  function Stream() {
    useSessionStream();
    counts.stream++;
    return null;
  }
  const children = (
    <>
      <Queue />
      <Prompts />
      <Turn />
      <Stream />
    </>
  );
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionStreamProvider sessionId="sess-1">{children}</SessionStreamProvider>
        </QueryClientProvider>,
      ),
    );
  render();
  const before = { ...counts },
    initialPrompts = promptEvents,
    initialTurn = turn;
  for (let index = 0; index < 5; index++) {
    reply = { ...reply, data: { role: 'provider', content: `reply ${index}` } };
    streamState.events = [user, reply];
    render();
  }
  expect(counts.queue).toBe(before.queue);
  expect(counts.prompts).toBe(before.prompts);
  expect(counts.turn).toBe(before.turn);
  expect(counts.stream).toBeGreaterThan(before.stream);
  expect(promptEvents).toBe(initialPrompts);
  expect(turn).toBe(initialTurn);
  act(() => useMessageQueueStore.getState().enqueueMessage('sess-1', 'queued'));
  expect(counts.queue).toBeGreaterThan(before.queue);
  expect(counts.turn).toBe(before.turn);
  streamState.events = [
    ...streamState.events,
    { ...ghostEvent(), id: 3, type: 'status', data: { status: 'turn_end' } } as SessionEventRow,
  ];
  render();
  expect(turn).toBeNull();
  expect(counts.turn).toBeGreaterThan(before.turn);
  streamState.events = [{ ...user, data: { ...user.data, content: 'edited' } }, reply];
  render();
  expect(promptEvents[0].data.content).toBe('edited');
  expect(promptEvents).not.toBe(initialPrompts);
  function currentTurn(): ReturnType<typeof useSessionResponseState>['turn'] {
    return turn;
  }
  const retry = {
    attempt: 1,
    nextRetryAt: '2026-10-07T12:00:00Z',
    message: 'Retrying',
    httpStatus: 504,
  };
  const retryEvent = {
    ...ghostEvent(),
    id: 4,
    type: 'status' as const,
    data: { status: 'session_info_update', retry },
  };
  streamState.events = [...streamState.events, retryEvent];
  render();
  expect(currentTurn()?.phase).toBe('retrying');
  streamState.events = [
    ...streamState.events.slice(0, -1),
    {
      ...retryEvent,
      data: { ...retryEvent.data, retry: { ...retry, attempt: 2, message: 'Retry again' } },
    },
  ];
  render();
  expect(currentTurn()?.retry?.attempt).toBe(2);
  expect(currentTurn()?.retry?.message).toBe('Retry again');
  streamState.events = [
    ...streamState.events.slice(0, -1),
    { ...retryEvent, data: { status: 'session_info_update', retry: null } },
  ];
  render();
  expect(currentTurn()?.phase).toBe('active');
  await act(async () => {
    queryClient.setQueryData(['session-execution', 'sess-1'], { queue: [], attention: 'approval' });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(currentTurn()?.phase).toBe('approval');
});
