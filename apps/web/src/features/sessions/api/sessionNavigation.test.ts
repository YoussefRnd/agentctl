import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { QueryClient } from '@tanstack/react-query';
import { initialHistoryOptions, prefetchSessionNavigation } from './sessionNavigation';
import { sessionKeys } from '@/shared/lib/queryKeys';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), detail: vi.fn() }));
vi.mock('@agentctl/api-client', () => ({
  apiClient: { fetch: mocks.fetch },
  api: { getSessionById: mocks.detail },
}));
const id = '00000000-0000-4000-8000-000000000010';
const page = { events: [], nextBeforeId: 201, nextAfterId: null };
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 10000 } },
  });
  clients.push(value);
  return value;
}
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.resetAllMocks();
});

describe('session navigation intent', () => {
  it('shares an in-flight initial page with navigation and keeps its cursor metadata', async () => {
    const c = client();
    let finish!: (value: typeof page) => void;
    mocks.fetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.detail.mockResolvedValue({ status: 200, body: { session: { id }, capabilities: [] } });
    const first = prefetchSessionNavigation(c, id);
    expect(prefetchSessionNavigation(c, id)).toBe(first);
    const navigation = c.fetchQuery(initialHistoryOptions(id));
    finish(page);
    await first;
    expect(await navigation).toEqual(page);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(c.getQueryData(sessionKeys.detail(id))).toMatchObject({ session: { id } });
    expect(c.getQueryData(sessionKeys.events(id))).toBeUndefined();
  });

  it('does not fetch or replace history that already has live events', async () => {
    const c = client();
    const live = [{ id: 12, data: { content: 'live output' } }];
    c.setQueryData(sessionKeys.events(id), live);
    mocks.detail.mockResolvedValue({ status: 200, body: { session: { id } } });
    await prefetchSessionNavigation(c, id);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(c.getQueryData(sessionKeys.events(id))).toBe(live);
  });

  it('limits speculative sessions and frees slots after a failed prefetch', async () => {
    const c = client();
    let fail!: (error: Error) => void;
    mocks.fetch.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    mocks.detail.mockResolvedValue({ status: 200, body: {} });
    const a = prefetchSessionNavigation(c, 'a');
    const b = prefetchSessionNavigation(c, 'b');
    await prefetchSessionNavigation(c, 'c');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    fail(new Error('offline'));
    await Promise.all([a, b]);
    mocks.fetch.mockResolvedValue(page);
    await prefetchSessionNavigation(c, 'c');
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('refreshes expired prefetch data and retries failed intent when the session opens', async () => {
    const c = client();
    c.setQueryData(initialHistoryOptions(id).queryKey, page, { updatedAt: Date.now() - 6000 });
    const next = { events: [], nextBeforeId: null };
    mocks.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(next);
    mocks.detail.mockResolvedValue({ status: 200, body: {} });
    await prefetchSessionNavigation(c, id);
    expect(await c.fetchQuery(initialHistoryOptions(id))).toEqual(next);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
