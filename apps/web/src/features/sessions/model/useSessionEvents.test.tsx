import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionEventRow, SessionEventSnapshot } from '@agentctl/shared';
import { mergeEventHistory, useSessionEvents } from './useSessionEvents';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  engines: [] as Array<{
    onEventsUpdate: (events: SessionEventRow[]) => void;
    onHistorySnapshot: (snapshot: SessionEventSnapshot) => void;
  }>,
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

it('resets paged history on reconnect while preserving unsent messages and ignoring stale page results', async () => {
  mocks.fetch.mockResolvedValueOnce({ events: [event(5), event(6)], nextBeforeId: 5 });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  client.setQueryData(
    ['events', sessionId],
    [
      event(5),
      event(6),
      {
        ...event(-1, 'Unsent'),
        data: { role: 'user', content: 'Unsent', deliveryStatus: 'queued' },
      },
    ],
  );
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
    mocks.engines[0].onHistorySnapshot({
      events: [event(100), event(101)],
      nextBeforeId: 100,
      highWaterId: 101,
    });
    mocks.engines[0].onEventsUpdate([event(102)]);
    resolve({ events: [event(1), event(2)], nextBeforeId: null });
    await pending;
  });
  await settle();
  expect(hook.events.map((row) => row.id)).toEqual([100, 101, 102, -1]);
  expect(hook.hasMore).toBe(true);
  mocks.fetch.mockResolvedValueOnce({ events: [event(99)], nextBeforeId: 99 });
  await act(async () => {
    await hook.loadOlder();
  });
  expect(mocks.fetch).toHaveBeenLastCalledWith(
    `/api/sessions/${sessionId}/events/page?limit=200&beforeId=100`,
    { signal: expect.any(AbortSignal) },
  );
  expect(mocks.connect).toHaveBeenCalledTimes(1);
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

it('jumps directly to an older window, pages forward without gaps, and keeps live updates separate', async () => {
  mocks.fetch.mockResolvedValueOnce({ events: [event(900), event(901)], nextBeforeId: 900 });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  mocks.fetch.mockResolvedValueOnce({
    events: [event(10), event(11)],
    nextBeforeId: 10,
    nextAfterId: 11,
  });
  await act(async () => {
    await hook.loadEvent(10);
  });
  await settle();
  expect(mocks.fetch).toHaveBeenLastCalledWith(
    `/api/sessions/${sessionId}/events/page?limit=200&aroundId=10`,
    { signal: expect.any(AbortSignal) },
  );
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([10, 11]);
  expect(hook.hasNewer).toBe(true);
  await act(async () => mocks.engines[0].onEventsUpdate([event(902)]));
  await settle();
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([10, 11]);
  expect(hook.events.at(-1)?.id).toBe(902);
  mocks.fetch.mockResolvedValueOnce({
    events: [event(12), event(13)],
    nextBeforeId: 12,
    nextAfterId: 13,
  });
  await act(async () => {
    await hook.loadNewer();
  });
  await settle();
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([10, 11, 12, 13]);
  await act(async () => hook.returnToLatest());
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([900, 901, 902]);
  expect(hook.hasNewer).toBe(false);
});

it('cancels a superseded jump and ignores its late response', async () => {
  mocks.fetch.mockResolvedValueOnce({ events: [event(900)], nextBeforeId: 900 });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  let finish!: (page: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let first!: Promise<void>;
  await act(async () => {
    first = hook.loadEvent(10);
  });
  const signal = mocks.fetch.mock.calls.at(-1)![1].signal as AbortSignal;
  mocks.fetch.mockResolvedValueOnce({
    events: [event(50), event(51)],
    nextBeforeId: 50,
    nextAfterId: 51,
  });
  await act(async () => {
    await hook.loadEvent(50);
  });
  await settle();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ events: [event(10)], nextBeforeId: 10, nextAfterId: 10 });
    await first;
  });
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([50, 51]);
});

it('bounds loaded history while retaining an older cursor for discarded rows', async () => {
  mocks.fetch.mockResolvedValueOnce({
    events: Array.from({ length: 200 }, (_, i) => event(i + 1001)),
    nextBeforeId: 1001,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  for (let start = 801; start >= 1; start -= 200) {
    mocks.fetch.mockResolvedValueOnce({
      events: Array.from({ length: 200 }, (_, i) => event(i + start)),
      nextBeforeId: start === 1 ? null : start,
    });
    await act(async () => {
      await hook.loadOlder();
    });
    await settle();
  }
  expect(hook.visibleEvents).toHaveLength(1000);
  expect(hook.events.length).toBeLessThanOrEqual(1200);
  expect(hook.hasNewer).toBe(true);
  await act(async () => hook.returnToLatest());
  expect(hook.visibleEvents[0].id).toBe(1001);
  expect(hook.hasOlder).toBe(true);
});

it('retains the owning input when restoring a latest page with an earlier turn anchor', async () => {
  const reply = (id: number): SessionEventRow => ({
    ...event(id),
    type: 'text',
    parentEventId: 1,
    data: { role: 'provider', content: String(id) },
  });
  mocks.fetch.mockResolvedValueOnce({
    events: [event(1), reply(900), reply(901)],
    nextBeforeId: 900,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  await settle();
  mocks.fetch.mockResolvedValueOnce({
    events: [reply(100), reply(101)],
    nextBeforeId: 100,
    nextAfterId: 101,
  });
  await act(async () => {
    await hook.loadEvent(100);
  });
  await settle();
  await act(async () => hook.returnToLatest());
  expect(hook.visibleEvents.map((row) => row.id)).toEqual([1, 900, 901]);
});
