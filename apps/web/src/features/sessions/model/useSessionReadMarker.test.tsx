// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { useSessionReadMarker } from './useSessionReadMarker';

const { patch } = vi.hoisted(() => ({ patch: vi.fn().mockResolvedValue({}) }));
vi.mock('@agentctl/api-client', () => ({ patchSession: patch }));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let focused = true;
let visibility = 'visible';
function Probe({ id = 'first', eventId = 10, enabled = true }) {
  useSessionReadMarker(id, eventId, enabled);
  return null;
}
const render = async (props: { id?: string; eventId?: number; enabled?: boolean } = {}) => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe {...props} />
      </QueryClientProvider>,
    ),
  );
};
const tick = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  patch.mockReset().mockResolvedValue({});
  focused = true;
  visibility = 'visible';
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('acknowledges only visible current history and retries when the window regains focus', async () => {
  await render({ enabled: false });
  await tick();
  expect(patch).not.toHaveBeenCalled();
  visibility = 'hidden';
  await render();
  await tick();
  expect(patch).not.toHaveBeenCalled();
  visibility = 'visible';
  focused = false;
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await tick();
  expect(patch).not.toHaveBeenCalled();
  focused = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await tick();
  expect(patch).toHaveBeenLastCalledWith('first', { lastReadEventId: 10 });
  await act(async () => window.dispatchEvent(new Event('focus')));
  await tick();
  expect(patch).toHaveBeenCalledTimes(1);
  await render({ eventId: 11 });
  focused = false;
  await tick();
  expect(patch).toHaveBeenCalledTimes(1);
  focused = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  await tick();
  expect(patch).toHaveBeenLastCalledWith('first', { lastReadEventId: 11 });
});
it('cancels a pending acknowledgement when navigation changes the chat', async () => {
  await render();
  await render({ id: 'second', eventId: 20 });
  await tick();
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith('second', { lastReadEventId: 20 });
});

it('retains unread state after a failed acknowledgement and retries on focus', async () => {
  patch.mockRejectedValueOnce(new Error('offline'));
  await render();
  await tick();
  expect(patch).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await tick();
  expect(patch).toHaveBeenCalledTimes(2);
  expect(patch).toHaveBeenLastCalledWith('first', { lastReadEventId: 10 });
});
