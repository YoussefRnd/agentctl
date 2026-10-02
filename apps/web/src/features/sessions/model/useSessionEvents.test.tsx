import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { mergeEventHistory, useSessionEvents } from './useSessionEvents';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  engines: [] as Array<{ onEventsUpdate: (events: SessionEventRow[]) => void }>,
}));
vi.mock('@agentctl/api-client', () => ({
  apiClient: { fetch: mocks.fetch },
  getDesktopCapability: () => null,
}));
vi.mock('@agentctl/shared', async (original) => ({
  ...(await original<typeof import('@agentctl/shared')>()),
  SessionEngine: class {
    constructor(options: (typeof mocks.engines)[number]) {
      mocks.engines.push(options);
    }
    connect = mocks.connect;
    disconnect = mocks.disconnect;
  },
}));
const sessionId = '11111111-1111-4111-8111-111111111111';
function event(id: number, content = String(id)): SessionEventRow {
  return { id, sessionId, type: 'text', data: { role: 'user', content }, createdAt: new Date() };
}
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let hook: ReturnType<typeof useSessionEvents>;
function Harness() {
  hook = useSessionEvents(sessionId);
  return null;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.engines.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

it('loads only the latest page, preserves live updates during pagination, and deduplicates turn anchors', async () => {
  mocks.fetch.mockResolvedValueOnce({ events: [event(5), event(6)], nextBeforeId: 5 });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(
    `/api/sessions/${sessionId}/events/page?limit=200`,
  );
  expect(mocks.connect).toHaveBeenCalledWith(6);
  let resolve!: (page: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = hook.loadOlder();
  });
  await act(async () => {
    mocks.engines[0].onEventsUpdate([event(6, 'updated'), event(7)]);
    resolve({ events: [event(1), event(2), event(5, 'old snapshot')], nextBeforeId: null });
    await pending;
  });
  await settle();
  expect(hook.events.map((row) => row.id)).toEqual([1, 2, 5, 6, 7]);
  expect(hook.events.find((row) => row.id === 6)?.data).toMatchObject({ content: 'updated' });
  expect(hook.events.find((row) => row.id === 5)?.data).toMatchObject({ content: '5' });
  expect(hook.hasMore).toBe(false);
  expect(mocks.connect).toHaveBeenCalledTimes(1);
});

it('keeps the cursor and current conversation when an older page fails, allowing a retry', async () => {
  mocks.fetch.mockResolvedValueOnce({ events: [event(5)], nextBeforeId: 5 });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  mocks.fetch.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await hook.loadOlder();
  });
  expect(hook.historyError).toBe('offline');
  expect(hook.events).toHaveLength(1);
  expect(hook.hasMore).toBe(true);
  mocks.fetch.mockResolvedValueOnce({ events: [event(1)], nextBeforeId: null });
  await act(async () => {
    await hook.loadOlder();
  });
  await settle();
  expect(hook.historyError).toBeNull();
  expect(hook.events.map((row) => row.id)).toEqual([1, 5]);
});

it('keeps optimistic messages after sorted persisted history', () => {
  expect(
    mergeEventHistory([event(2), event(1)], [event(3), event(-1), event(-2)]).map((row) => row.id),
  ).toEqual([1, 2, 3, -1, -2]);
});

it('exposes a failed initial page and retries it before starting the live stream', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('offline'));
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  expect(hook.historyError).toBe('offline');
  expect(mocks.connect).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValueOnce({ events: [event(5)], nextBeforeId: null });
  await act(async () => {
    await hook.loadOlder();
  });
  await settle();
  expect(hook.historyError).toBeNull();
  expect(hook.events.map((row) => row.id)).toEqual([5]);
  expect(mocks.connect).toHaveBeenCalledWith(5);
});
