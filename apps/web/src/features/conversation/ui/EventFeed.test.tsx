import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SessionEventRow, SessionTurnAnchor } from '@agentctl/shared';
import type { ConversationTurn } from '../lib/turnMinimapGrouping';
import { EventFeed } from './EventFeed';

const stream = vi.hoisted(() => ({
  streamingEventId: null,
  hasMoreHistory: true,
  historyRevision: 0,
  loadOlderHistory: vi.fn(),
  loadEventHistory: vi.fn(),
  isLoadingOlderHistory: false,
  historyError: null as string | null,
  turnIndex: undefined as SessionTurnAnchor[] | undefined,
}));
vi.mock('@/features/sessions', () => ({
  useSession: () => ({
    sessionId: 'session',
    sessionData: { session: { id: 'session', status: 'idle' } },
  }),
  useSessionStream: () => stream,
  useSessionTurnIndex: () => ({ data: stream.turnIndex }),
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
vi.mock('./TurnMinimap', () => ({
  TurnMinimap: ({
    turns,
    onSelectTurn,
  }: {
    turns: ConversationTurn[];
    onSelectTurn: (turn: ConversationTurn) => void;
  }) => (
    <div data-timeline>
      {turns.map((turn) => (
        <button
          key={turn.id}
          aria-label={`Turn ${turn.turnIndex + 1}`}
          onClick={() => onSelectTurn(turn)}
        />
      ))}
    </div>
  ),
}));
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
  stream.hasMoreHistory = true;
  stream.historyRevision = 0;
  stream.isLoadingOlderHistory = false;
  stream.historyError = null;
  stream.turnIndex = undefined;
  stream.loadOlderHistory.mockReset().mockResolvedValue(undefined);
  stream.loadEventHistory.mockReset().mockResolvedValue(undefined);
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
  viewport.scrollTop = 40;
  const previousTop = viewport.scrollTop;
  expect(container.textContent).not.toContain('Load earlier messages');
  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  expect(stream.loadOlderHistory).toHaveBeenCalledOnce();
  expect(viewport.scrollTop).toBe(previousTop);
});

it('loads only near the top and prevents duplicate requests during upward scrolling', async () => {
  let finish!: () => void;
  stream.loadOlderHistory.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render(250);
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  await act(async () => {
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
  await act(async () => {
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  });
  expect(stream.loadOlderHistory).toHaveBeenCalledOnce();
  await act(async () => finish());
});

it('stops automatic loading after an error and offers an explicit retry', async () => {
  stream.historyError = 'History request failed';
  await render(250);
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  await act(async () => {
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Couldn’t load earlier messages',
  );
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry',
  )!;
  await act(async () => retry.click());
  expect(stream.loadOlderHistory).toHaveBeenCalledOnce();
});

it('shows a quiet loading status without another history action', async () => {
  stream.isLoadingOlderHistory = true;
  await render(250);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    'Loading earlier messages',
  );
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  await act(async () => {
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
});

it('keeps the same message at the same reading position when an older page is prepended', async () => {
  let finish!: () => void;
  stream.loadOlderHistory.mockImplementation(() => {
    stream.isLoadingOlderHistory = true;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const recent = events.slice(300);
  await render(450, recent);
  await render(undefined, recent);
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  await act(async () => {
    viewport.scrollTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }));
  });
  stream.isLoadingOlderHistory = true;
  await render(undefined, recent);
  const messageOffset = () => {
    const row = container
      .querySelector('[data-message="301"]')
      ?.closest('[data-index]') as HTMLElement;
    return Number.parseFloat(row.style.transform.slice('translateY('.length));
  };
  const readingOffset = viewport.scrollTop - messageOffset();
  stream.isLoadingOlderHistory = false;
  await act(async () => finish());
  await render(undefined, events);
  await act(async () => viewport.dispatchEvent(new Event('scroll')));
  expect(viewport.scrollTop).toBeGreaterThan(40);
  expect(viewport.scrollTop - messageOffset()).toBeCloseTo(readingOffset);
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

it('keeps every timeline tick and navigates directly to an unloaded turn without a highlight', async () => {
  stream.turnIndex = events.map((event) => ({
    eventId: event.id,
    prompt: String(event.data.content),
    timestamp: new Date(event.createdAt!).toISOString(),
  }));
  stream.loadOlderHistory.mockImplementation(async () => {
    stream.isLoadingOlderHistory = true;
  });
  const recent = events.slice(300);
  await render(undefined, recent);
  expect(container.querySelectorAll('[data-timeline] button')).toHaveLength(500);
  expect(container.querySelector('[data-message="1"]')).toBeNull();
  await act(async () =>
    (container.querySelector('[aria-label="Turn 1"]') as HTMLButtonElement).click(),
  );
  expect(stream.loadEventHistory).toHaveBeenCalledExactlyOnceWith(1);
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
  stream.isLoadingOlderHistory = false;
  await render(undefined, events.slice(100));
  expect(stream.loadEventHistory).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('[data-timeline] button')).toHaveLength(500);
  expect(container.querySelector('[data-message="1"]')).toBeNull();
  stream.isLoadingOlderHistory = false;
  stream.hasMoreHistory = false;
  await render(undefined, events);
  expect(container.querySelectorAll('[data-timeline] button')).toHaveLength(500);
  expect(container.querySelector('[data-message="1"]')).not.toBeNull();
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  expect(viewport.scrollTop).toBeLessThan(200);
  expect(container.querySelector('[data-message="1"]')?.parentElement?.className).not.toContain(
    'ring-2',
  );
});

it('does not prefetch older pages for a programmatic timeline jump', async () => {
  await render(250);
  const viewport = container.querySelector('[tabindex="0"]') as HTMLElement;
  await act(async () => {
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  expect(stream.loadOlderHistory).not.toHaveBeenCalled();
  await act(async () =>
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true })),
  );
  expect(stream.loadOlderHistory).toHaveBeenCalledOnce();
});

it('retries a pending direct jump after a reconnect refresh', async () => {
  await render(1, events.slice(300));
  expect(stream.loadEventHistory).toHaveBeenCalledExactlyOnceWith(1);
  stream.historyRevision++;
  await render(1, events.slice(300));
  expect(stream.loadEventHistory).toHaveBeenCalledTimes(2);
});
