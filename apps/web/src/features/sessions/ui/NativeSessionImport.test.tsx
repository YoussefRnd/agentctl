import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NativeSessionImport } from './NativeSessionImport';
const mocks = vi.hoisted(() => ({ list: vi.fn(), import: vi.fn() }));
vi.mock('@agentctl/api-client', async (original) => ({
  ...(await original<typeof import('@agentctl/api-client')>()),
  providerService: { listNativeSessions: mocks.list, importNativeSession: mocks.import },
}));
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let client: QueryClient;
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => {
    button.click();
    await flush();
  });
};
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
});
test('loads more native sessions, imports a selected session, and opens existing imports', async () => {
  mocks.list.mockImplementation(async (_provider: string, _project: string, cursor?: string) =>
    cursor
      ? { sessions: [{ sessionId: 'second', cwd: '/tmp', title: 'Second' }] }
      : {
          sessions: [
            { sessionId: 'first', cwd: '/tmp', title: 'First', importedSessionId: 'local-first' },
          ],
          nextCursor: 'page-two',
        },
  );
  mocks.import.mockResolvedValue({ sessionId: 'local-second' });
  const opened = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NativeSessionImport providerId="profile" projectId="project" onImported={opened} />
      </QueryClientProvider>,
    ),
  );
  await act(flush);
  await click('Open');
  expect(opened).toHaveBeenCalledWith('local-first');
  expect(mocks.import).not.toHaveBeenCalled();
  await click('Load more');
  expect(mocks.list).toHaveBeenCalledWith('profile', 'project', 'page-two');
  await click('Import');
  expect(mocks.import).toHaveBeenCalledWith('profile', 'project', 'second', 'Second');
  expect(opened).toHaveBeenCalledWith('local-second');
});
test('failed imports stay on the list for retry', async () => {
  mocks.list.mockResolvedValue({
    sessions: [{ sessionId: 'native', cwd: '/tmp', title: 'Existing' }],
  });
  mocks.import.mockRejectedValue(new Error('Session not found'));
  const opened = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NativeSessionImport providerId="profile" projectId="project" onImported={opened} />
      </QueryClientProvider>,
    ),
  );
  await act(flush);
  await click('Import');
  expect(opened).not.toHaveBeenCalled();
  expect(container.querySelector('button')?.disabled).toBe(false);
});
