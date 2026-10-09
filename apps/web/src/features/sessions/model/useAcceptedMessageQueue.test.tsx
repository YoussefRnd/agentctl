import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useAcceptedMessageQueue } from './useAcceptedMessageQueue';

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  execution: vi.fn(),
  resume: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@agentctl/api-client', () => ({
  api: {
    changeQueuedMessage: mocks.change,
    getSessionExecution: mocks.execution,
    resumeSessionQueue: mocks.resume,
  },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
let root: ReturnType<typeof createRoot> | undefined;
let client: QueryClient;
let queue: ReturnType<typeof useAcceptedMessageQueue>;
const snapshot = {
  connection: 'connected',
  execution: 'running',
  attention: 'none',
  queue: [
    { id: 'waiting', eventId: 2, text: 'Original', attachmentIds: ['image'], status: 'queued' },
  ],
};
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  vi.resetAllMocks();
});
function Harness() {
  queue = useAcceptedMessageQueue('s');
  return null;
}
async function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['session-execution', 's'], snapshot);
  mocks.execution.mockResolvedValue({ status: 200, body: snapshot });
  root = createRoot(document.createElement('div'));
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
}
it('serializes queue actions, disables controls until refreshed, and reports dispatch conflicts', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  mocks.change.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = queue.changeMessage('waiting', 'edit', 'Changed');
  });
  expect(queue.pendingId).toBe('waiting');
  expect(await queue.changeMessage('waiting', 'cancel')).toBe(false);
  expect(mocks.change).toHaveBeenCalledOnce();
  expect(mocks.change).toHaveBeenCalledWith({
    params: { id: 's', commandId: 'waiting' },
    body: { action: 'edit', input: 'Changed' },
  });
  mocks.execution.mockResolvedValue({ status: 200, body: { ...snapshot, queue: [] } });
  await act(async () => {
    resolve({ status: 409, body: { message: 'Message is already running' } });
    expect(await pending).toBe(false);
  });
  expect(mocks.error).toHaveBeenCalledWith('Message is already running');
  expect(queue.pendingId).toBeUndefined();
  expect(queue.queuedMessages).toEqual([]);
});
