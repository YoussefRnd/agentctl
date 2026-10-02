import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';
import { sessionKeys, useMessageQueueStore } from '@/shared';

const mocks = vi.hoisted(() => ({
  sendInput: vi.fn(),
  getSessionById: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('./SessionContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./SessionContext')>()),
  // Deliberately stale: actions must check the current query cache before sending.
  useSession: () => ({ sessionId: 's', sessionData: { session: { status: 'idle' } } }),
}));
vi.mock('./useSessionEvents', () => ({
  useSessionEvents: () => ({
    events: [],
    isLoading: false,
    isConnected: true,
    streamingEventId: null,
  }),
}));
vi.mock('@agentctl/api-client', () => ({
  api: { sendInput: mocks.sendInput, getSessionById: mocks.getSessionById },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
import { SessionStreamProvider } from './SessionContext';
import { useSessionActions } from './useSessionActions';

let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let actions: ReturnType<typeof useSessionActions>;
function Harness() {
  actions = useSessionActions();
  return null;
}
function setStatus(status: 'idle' | 'running') {
  client.setQueryData(sessionKeys.detail('s'), {
    session: { id: 's', status },
    capabilities: [],
  } as unknown as SessionWithCapabilities);
}
beforeEach(() => {
  vi.resetAllMocks();
  useMessageQueueStore.getState().clearQueue();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  setStatus('idle');
  mocks.getSessionById.mockImplementation(async () => ({
    status: 200,
    body: client.getQueryData(sessionKeys.detail('s')),
  }));
  root = createRoot(document.createElement('div'));
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <SessionStreamProvider sessionId="s">
          <Harness />
        </SessionStreamProvider>
      </QueryClientProvider>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  useMessageQueueStore.getState().clearQueue();
});

it('queues a toast retry using current state and preserves its attachments', async () => {
  mocks.sendInput.mockRejectedValueOnce(new Error('not accepted'));
  await act(async () => {
    await actions.handleSend('first', ['attachment-1']);
  });
  const failed = client.getQueryData<SessionEventRow[]>(sessionKeys.events('s'))![0];
  const retry = mocks.toastError.mock.calls[0][1].action.onClick;
  await act(async () => {
    setStatus('running');
    retry();
    retry();
  });
  expect(mocks.sendInput).toHaveBeenCalledTimes(1);
  expect(useMessageQueueStore.getState().queuedMessages.s).toEqual([
    expect.objectContaining({
      text: 'first',
      attachmentIds: ['attachment-1'],
      optimisticEventId: failed.id,
    }),
  ]);
  expect(client.getQueryData<SessionEventRow[]>(sessionKeys.events('s'))).toEqual([
    expect.objectContaining({
      id: failed.id,
      data: expect.objectContaining({ deliveryStatus: 'queued' }),
    }),
  ]);
});

it('retries a retained failed message once with its original attachments', async () => {
  client.setQueryData(sessionKeys.events('s'), [
    {
      id: -1,
      sessionId: 's',
      type: 'text',
      data: {
        role: 'user',
        content: 'queued prompt',
        deliveryStatus: 'failed',
        attachmentIds: ['attachment-2'],
      },
      createdAt: new Date(),
    } satisfies SessionEventRow,
  ]);
  mocks.sendInput.mockResolvedValue({ status: 200, body: { success: true, eventId: 42 } });
  await act(async () => {
    actions.handleRetry(-1);
    actions.handleRetry(-1);
  });
  expect(mocks.sendInput).toHaveBeenCalledTimes(1);
  expect(mocks.sendInput).toHaveBeenCalledWith({
    params: { id: 's' },
    body: {
      input: 'queued prompt',
      attachmentIds: ['attachment-2'],
      clientMessageId: expect.any(String),
    },
  });
  expect(client.getQueryData<SessionEventRow[]>(sessionKeys.events('s'))).toEqual([
    expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'accepted' }) }),
  ]);
});

it('keeps the remaining queue paused if a timeline retry fails again', async () => {
  client.setQueryData(sessionKeys.events('s'), [
    {
      id: -1,
      sessionId: 's',
      type: 'text',
      data: { role: 'user', content: 'queued prompt', deliveryStatus: 'queued' },
      createdAt: new Date(),
    } satisfies SessionEventRow,
  ]);
  mocks.sendInput.mockRejectedValue(new Error('not accepted'));
  await act(async () => {
    const queue = useMessageQueueStore.getState();
    queue.enqueueMessage('s', 'queued prompt', undefined, -1);
    queue.enqueueMessage('s', 'later');
  });
  await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
  await act(async () => actions.handleRetry(-1));
  await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(2));
  await act(async () => {
    setStatus('idle');
  });
  expect(mocks.sendInput).toHaveBeenCalledTimes(2);
  expect(useMessageQueueStore.getState().queuedMessages.s).toHaveLength(2);
  expect(useMessageQueueStore.getState().queuedMessages.s[0].status).toBe('failed');
  expect(client.getQueryData<SessionEventRow[]>(sessionKeys.events('s'))![0]).toMatchObject({
    data: { deliveryStatus: 'failed' },
  });
});
