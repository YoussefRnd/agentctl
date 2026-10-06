import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { EventFeed } from './EventFeed';

const stream = vi.hoisted(() => ({
  streamingEventId: null,
  hasMoreHistory: true,
  loadOlderHistory: vi.fn(),
  isLoadingOlderHistory: false,
  historyError: null,
}));
vi.mock('@/features/sessions', () => ({
  useSession: () => ({
    sessionId: 'session',
    sessionData: { session: { id: 'session', status: 'idle' } },
  }),
  useSessionStream: () => stream,
}));
vi.mock('./EventFeedItem', async () => {
  const { TurnErrorCard } = await import('./cards/TurnErrorCard');
  return {
    EventFeedItem: ({ group }: { group: { type: string; event: SessionEventRow } }) =>
      group.type === 'error' ? (
        <TurnErrorCard
          message={group.event.type === 'status' ? String(group.event.data.message) : undefined}
        />
      ) : (
        <div data-message={group.event.id}>{String(group.event.data.content)}</div>
      ),
  };
});
vi.mock('./TurnMinimap', () => ({ TurnMinimap: () => null }));
vi.mock('@/shared', () => ({ AgentIcon: () => null }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
const events: SessionEventRow[] = Array.from({ length: 500 }, (_, index) => ({
  id: index + 1,
  sessionId: 'session',
  type: 'text',
  data: { role: 'user', content: `Message ${index + 1}` },
  createdAt: new Date(),
}));
beforeEach(() => {
  stream.loadOlderHistory.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const height = this.hasAttribute('data-index') ? 100 : 600;
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-index') ? 100 : 600;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return (
      Number.parseFloat(
        (this.querySelector('[style*="height"]') as HTMLElement | null)?.style.height ?? '0',
      ) || 600
    );
  });
  HTMLElement.prototype.scrollTo = function (
    this: HTMLElement,
    options?: ScrollToOptions | number,
  ) {
    this.scrollTop = typeof options === 'number' ? options : (options?.top ?? 0);
    this.dispatchEvent(new Event('scroll'));
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient();
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(targetEventId?: number, feedEvents: SessionEventRow[] = events) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <EventFeed events={feedEvents} targetEventId={targetEventId} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

it('renders a small window of a long conversation and can navigate to an off-screen event', async () => {
  await render(250);
  const mounted = container.querySelectorAll('[data-message]');
  expect(mounted.length).toBeGreaterThan(0);
  expect(mounted.length).toBeLessThan(30);
  expect(container.querySelector('[data-message="250"]')).not.toBeNull();
  expect(container.querySelector('[data-message="1"]')).toBeNull();
});

it('requests older history without jumping back to the end of the conversation', async () => {
  await render(250);
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  const previousTop = viewport.scrollTop;
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === 'Load earlier messages',
  );
  await act(async () => {
    button!.click();
  });
  expect(stream.loadOlderHistory).toHaveBeenCalledOnce();
  expect(viewport.scrollTop).toBe(previousTop);
});

it('keeps a foreground failure with its original input when another input is queued', async () => {
  const failed: SessionEventRow[] = [
    events[0],
    {
      id: 2,
      sessionId: 'session',
      type: 'status',
      parentEventId: 1,
      data: { status: 'prompt_failed', message: 'Provider quota exhausted' },
      createdAt: new Date(),
    },
  ];
  await render(undefined, failed);
  expect(container.textContent).toContain('Agent run failed');
  expect(container.textContent).toContain('Provider quota exhausted');
  expect(container.textContent).not.toContain('Refresh session');
  await render(undefined, [failed[0], { ...events[2], id: 3 }, { ...failed[1], id: 4 }]);
  expect(container.textContent).toContain('Provider quota exhausted');
  const text = container.textContent!;
  expect(text.indexOf('Provider quota exhausted')).toBeLessThan(text.indexOf('Message 3'));
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
});
