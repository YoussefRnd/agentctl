// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { MainFeed } from './MainFeed';
import { useSubagentStore } from '@/features/subagents';

const state = vi.hoisted(() => ({
  sessionId: 'session-a',
  events: [] as SessionEventRow[],
  isConnected: true,
  approve: vi.fn(),
  deny: vi.fn(),
  feedMounts: 0,
  invalidate: vi.fn(),
  rewind: vi.fn(),
  send: vi.fn(),
  undo: vi.fn(),
  rewindHandler: null as
    null | ((eventId: number, mode: 'conversation' | 'files' | 'fork') => void),
  editHandler: null as null | ((eventId: number, content: string) => Promise<boolean>),
}));
vi.mock('@agentctl/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agentctl/api-client')>()),
  rewindSession: state.rewind,
  undoRewind: state.undo,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/sessions/session-a', state: null }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: state.invalidate, getQueryData: () => undefined }),
}));
vi.mock('@/features/sessions', () => ({
  useSession: () => ({
    sessionId: state.sessionId,
    sessionData: { session: { id: state.sessionId, status: 'running', project: {} } },
    isLoadingSession: false,
  }),
  useSessionStream: () => ({
    events: state.events,
    isConnected: state.isConnected,
    isLoadingEvents: false,
    loadOlderHistory: vi.fn(),
  }),
  useSessionActions: () => ({
    handleSend: state.send,
    handleRetry: vi.fn(),
    handleApprove: state.approve,
    handleDeny: state.deny,
  }),
  useOpenWorkspaceFile: () => vi.fn(),
  useSessionTurnState: () => null,
  useSessionExecution: () => undefined,
  RewindConfirmDialog: ({
    open,
    isLoading,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean;
    isLoading: boolean;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog" aria-busy={isLoading}>
        <button onClick={onConfirm}>Confirm rewind</button>
        <button onClick={() => onOpenChange(false)}>Cancel rewind</button>
      </div>
    ) : null,
}));
vi.mock('@/features/providers', () => ({
  useProviders: () => ({ switchProvider: vi.fn(), isSwitching: false }),
  SwitchAgentModal: () => null,
}));
vi.mock('@/features/composer', () => ({
  CommandBar: ({ initialInput, disabled }: { initialInput?: string; disabled?: boolean }) => (
    <input aria-label="Message draft" data-initial-input={initialInput ?? ''} disabled={disabled} />
  ),
  useDraftStore: { getState: () => ({ updateHomeDraft: vi.fn() }) },
}));
vi.mock('@/features/review', () => ({
  useReviewUIStore: (select: (store: unknown) => unknown) =>
    select({ setReviewScope: vi.fn(), focusReviewFile: vi.fn() }),
}));
vi.mock('@/shared/stores/useWorkbenchStore', () => ({
  useWorkbenchStore: (select: (store: unknown) => unknown) =>
    select({ setWorkbenchTab: vi.fn(), setWorkbenchOpen: vi.fn() }),
}));
vi.mock('@/features/conversation', async () => ({
  StreamingMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
  UnifiedActivityBlock: ({ events }: { events: SessionEventRow[] }) => (
    <div>
      {events.map((event) => (
        <span key={event.id}>{event.type === 'tool_call' ? event.data.title : ''}</span>
      ))}
    </div>
  ),
  AgentTerminals: (await import('./cards/AgentTerminals')).AgentTerminals,
}));
vi.mock('./EventFeed', async () => {
  const { useEffect } = await import('react');
  const { SubagentBlock, extractSubagentGroups } = await import('@/features/subagents');
  return {
    EventFeed: ({
      events,
      onRewind,
      onEditSubmit,
    }: {
      events: SessionEventRow[];
      onRewind: typeof state.rewindHandler;
      onEditSubmit: typeof state.editHandler;
    }) => {
      state.rewindHandler = onRewind;
      state.editHandler = onEditSubmit;
      useEffect(() => {
        state.feedMounts++;
      }, []);
      return (
        <div data-testid="parent-feed">
          <p>Parent conversation</p>
          <SubagentBlock subagentGroups={extractSubagentGroups(events)} />
        </div>
      );
    },
  };
});

function row(id: number, type: string, data: unknown): SessionEventRow {
  return {
    id,
    sessionId: state.sessionId,
    type,
    data,
    createdAt: new Date(1700000000000 + id * 1000),
  } as SessionEventRow;
}
let root: Root;
let container: HTMLDivElement;
const render = () => act(() => root.render(<MainFeed />));
const inspect = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="parent-feed"] button[aria-label="Inspect Review"]',
  )!;
beforeEach(() => {
  state.sessionId = 'session-a';
  state.isConnected = true;
  state.feedMounts = 0;
  state.approve.mockClear();
  state.deny.mockClear();
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.rewind.mockReset().mockResolvedValue({});
  state.send.mockReset().mockResolvedValue(true);
  state.undo.mockReset().mockResolvedValue(undefined);
  state.events = [
    row(1, 'text', { role: 'user', content: 'Review my code' }),
    row(2, 'tool_call', {
      name: 'task',
      title: 'Review',
      toolCallId: 'review',
      status: 'in_progress',
      arguments: { prompt: 'Review files' },
    }),
  ];
  useSubagentStore.getState().setActiveSubagentId(null);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

describe('conversation history transitions', () => {
  test('does not change the composer draft when a rewind is cancelled', () => {
    render();
    act(() => state.rewindHandler!(1, 'conversation'));
    expect(container.querySelector('input')?.dataset.initialInput).toBe('');
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Cancel rewind')!
        .click(),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('input')?.dataset.initialInput).toBe('');
    expect(state.rewind).not.toHaveBeenCalled();
  });

  test('keeps rewind busy until history refresh finishes, even when the feed becomes empty', async () => {
    let finishRefresh!: () => void;
    // One shared gate releases all invalidations.
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    state.invalidate.mockReturnValue(refresh);
    render();
    act(() => state.rewindHandler!(1, 'conversation'));
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Confirm rewind')!
        .click();
    });
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('input')?.disabled).toBe(true);
    act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Cancel rewind')!
        .click(),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    state.events = [];
    render();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="parent-feed"]')).not.toBeNull();
    expect(state.feedMounts).toBe(1);
    await act(async () => finishRefresh());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('input')?.dataset.initialInput).toBe('Review my code');
    expect(container.querySelector('input')?.disabled).toBe(false);
    expect(state.rewind).toHaveBeenCalledExactlyOnceWith('session-a', 1, 'conversation');
  });

  test('serializes edited resubmission and waits for history before completing it', async () => {
    let finishRefresh!: () => void;
    state.invalidate.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
    );
    render();
    let edit!: Promise<boolean>;
    await act(async () => {
      edit = state.editHandler!(1, 'Updated prompt');
    });
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    await act(async () => expect(await state.editHandler!(1, 'Duplicate')).toBe(false));
    expect(state.send).toHaveBeenCalledExactlyOnceWith('Updated prompt', undefined);
    await act(async () => finishRefresh());
    expect(await edit).toBe(true);
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBeNull();
    expect(state.feedMounts).toBe(1);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSubagentStore.getState().setActiveSubagentId(null);
  vi.restoreAllMocks();
});

describe('subagent inspection within the parent conversation', () => {
  test('shows and opens delegation reported under the generic ACP other kind', () => {
    state.events = [
      row(1, 'text', { role: 'user', content: 'Dispatch four subagents' }),
      row(2, 'tool_call', {
        name: 'other',
        kind: 'other',
        title: 'Running start_subagent',
        toolCallId: 'opaque-launch-id',
        status: 'completed',
        rawOutput: 'Launch 4 test subagents',
      }),
    ];
    render();
    const card = container.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect Running start subagent"]',
    )!;
    expect(card).not.toBeNull();
    act(() => card.click());
    const details = document.querySelector('[aria-label="Subagent conversation"]')!;
    expect(details.textContent).toContain('Launch 4 test subagents');
    expect(details.textContent).toContain('No child activity was reported.');
  });

  test('opens a child in the chat area and returns focus to the parent on Escape', async () => {
    render();
    const card = inspect();
    card.focus();
    act(() => card.click());
    const back = container.querySelector<HTMLButtonElement>(
      '[aria-label="Back to parent conversation"]',
    )!;
    expect(container.querySelector('[data-parent-conversation]')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(back);
    expect(
      container.querySelector('[aria-label="Conversation breadcrumb"]')?.textContent,
    ).toContain('Parent conversation');
    act(() =>
      back.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(container.querySelector('[aria-label="Subagent conversation"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.querySelector('[data-parent-conversation]')?.hasAttribute('inert')).toBe(
      false,
    );
    expect(document.activeElement).toBe(card);
  });

  test('switches tasks in the conversation and keeps the assignment collapsed', () => {
    state.events = [
      ...state.events,
      row(3, 'tool_call', {
        name: 'task',
        title: 'Build',
        toolCallId: 'build',
        status: 'failed',
        arguments: { prompt: 'Compile /a/very/long/path/to/the/package.json' },
        rawOutput: 'Build failed: missing dependency',
      }),
    ];
    render();
    act(() => inspect().click());
    const selector = document.querySelector<HTMLSelectElement>(
      '[aria-label="Subagent conversation"] select',
    )!;
    const build = [...selector.options].find((option) => option.textContent?.startsWith('Build'))!;
    act(() => {
      selector.value = build.value;
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const panel = document.querySelector('[aria-label="Subagent conversation"]')!;
    expect(panel.querySelector('h2')?.textContent).toBe('Build');
    expect(panel.querySelector('[aria-label="Result"]')?.textContent).toContain('Build failed');
    const assignment = panel.querySelector('[aria-label="Task prompt"]')!
      .parentElement as HTMLDetailsElement;
    const activity = panel.querySelector('[aria-label="Reported activity"]')!
      .parentElement as HTMLDetailsElement;
    expect(assignment.open).toBe(false);
    expect(activity.open).toBe(false);
    expect(assignment.textContent).toContain('/a/very/long/path/to/the/package.json');
    expect(state.feedMounts).toBe(1);
  });

  test('keeps historical task status visible in the conversation', () => {
    state.events = [
      row(1, 'text', { role: 'user', content: 'Earlier work' }),
      row(2, 'subagent_update', {
        subagentId: 'old-child',
        name: 'Earlier review',
        status: 'running',
        historical: true,
      }),
    ];
    render();
    const card = container.querySelector<HTMLButtonElement>(
      '[aria-label="Inspect Earlier review"]',
    )!;
    expect(card.textContent).toContain('History');
    act(() => card.click());
    const panel = container.querySelector('[aria-label="Subagent conversation"]')!;
    expect(panel.textContent).toContain('History');
    expect(panel.textContent).not.toContain('Latest response');
  });

  test('keeps the parent feed and draft mounted while inspecting and closing a task', async () => {
    render();
    const draft = container.querySelector<HTMLInputElement>('[aria-label="Message draft"]')!;
    draft.value = 'Keep this draft';
    const card = inspect();
    card.focus();
    act(() => card.click());
    expect(document.querySelector('[aria-label="Subagent conversation"]')).not.toBeNull();
    expect(container.textContent).toContain('Parent conversation');
    expect(container.querySelector('[aria-label="Message draft"]')).toBe(draft);
    expect(state.feedMounts).toBe(1);
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Back to parent conversation"]')!
        .click(),
    );
    expect(document.querySelector('[aria-label="Subagent conversation"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.activeElement).toBe(card);
    expect(draft.value).toBe('Keep this draft');
    expect(state.feedMounts).toBe(1);
  });

  test('surfaces pending approvals even when the provider emits subsequent text', () => {
    render();
    act(() => inspect().click());
    state.events = [
      ...state.events,
      row(3, 'approval_request', {
        toolCallId: 'review',
        status: 'pending',
        request: {
          description: 'Review needs permission',
          toolCall: { name: 'task' },
          options: [
            { optionId: 'once', label: 'Approve review once', kind: 'allow_once' },
            { optionId: 'no', label: 'Deny review', kind: 'reject_once' },
          ],
        },
      }),
      row(4, 'text', { role: 'provider', content: 'Other parallel work' }),
    ];
    render();
    expect(container.querySelector('[data-parent-conversation]')?.textContent).toContain(
      'Approve review once',
    );
    expect(document.querySelector('[aria-label="Subagent conversation"]')?.textContent).toContain(
      'Needs approval',
    );
    const review = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Review approval in chat',
    )!;
    act(() => review.click());
    expect(document.querySelector('[aria-label="Subagent conversation"]')).toBeNull();
    const approve = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve review once',
    )!;
    act(() => approve.click());
    expect(state.approve).toHaveBeenCalledWith(3, 'once');
    state.events = state.events.map((event) =>
      event.id === 3
        ? ({ ...event, data: { ...event.data, status: 'approved' } } as SessionEventRow)
        : event,
    );
    render();
    expect(container.textContent).not.toContain('Approve review once');
  });

  test('updates the selected result without a status change and renders it once', () => {
    state.events = state.events.map((event, index) =>
      index === 1
        ? ({
            ...state.events[1],
            data: { ...state.events[1].data, status: 'completed', rawOutput: 'Initial result' },
          } as SessionEventRow)
        : event,
    );
    render();
    act(() => inspect().click());
    state.events = state.events.map((event, index) =>
      index === 1
        ? ({
            ...state.events[1],
            data: { ...state.events[1].data, rawOutput: 'Updated result' },
          } as SessionEventRow)
        : event,
    );
    render();
    const panel = document.querySelector('[aria-label="Subagent conversation"]')!;
    expect(panel.textContent).toContain('No child activity was reported');
    expect(panel.textContent?.match(/Updated result/g)).toHaveLength(1);
    expect(panel.querySelector('input')).toBeNull();
  });

  test('shows child tools and responses in order without repeating the transcript as a result', () => {
    const firstResponse = row(4, 'text', { role: 'provider', content: 'Found the models' });
    const lastResponse = row(6, 'text', { role: 'provider', content: 'Review complete' });
    state.events = [
      state.events[0],
      row(2, 'subagent_update', {
        subagentId: 'child',
        native: true,
        name: 'Review',
        status: 'completed',
        result: { summary: 'Found the models\n\nReview complete' },
      }),
      {
        ...row(3, 'tool_call', {
          name: 'read',
          title: 'Read schema',
          toolCallId: 'read',
          status: 'completed',
        }),
        parentEventId: 2,
      },
      { ...firstResponse, parentEventId: 2 },
      {
        ...row(5, 'tool_call', {
          name: 'execute',
          title: 'Run checks',
          toolCallId: 'checks',
          status: 'completed',
        }),
        parentEventId: 2,
      },
      { ...lastResponse, parentEventId: 2 },
    ];
    render();
    act(() => inspect().click());
    const panel = container.querySelector('[aria-label="Subagent conversation"]')!;
    const text = panel.textContent!;
    expect(text.indexOf('Read schema')).toBeLessThan(text.indexOf('Found the models'));
    expect(text.indexOf('Found the models')).toBeLessThan(text.indexOf('Run checks'));
    expect(text.indexOf('Run checks')).toBeLessThan(text.indexOf('Review complete'));
    expect(text.match(/Found the models/g)).toHaveLength(1);
    expect(text.match(/Review complete/g)).toHaveLength(1);
    expect(panel.querySelector('[aria-label="Result"]')).toBeNull();
    expect(panel.querySelector('[aria-label="Reported activity"]')).toBeNull();
    expect(panel.textContent).toContain('Read-only');
  });

  test('preserves expanded context when a live task reports its result', () => {
    render();
    act(() => inspect().click());
    const panel = document.querySelector('[aria-label="Subagent conversation"]')!;
    const activity = panel.querySelector('[aria-label="Reported activity"]')!
      .parentElement as HTMLDetailsElement;
    const assignment = panel.querySelector('[aria-label="Task prompt"]')!
      .parentElement as HTMLDetailsElement;
    expect(activity.open).toBe(true);
    act(() => {
      assignment.open = true;
      assignment.dispatchEvent(new Event('toggle'));
    });
    state.events = state.events.map((event) =>
      event.id === 2
        ? ({
            ...event,
            data: { ...event.data, status: 'completed', rawOutput: 'Review finished' },
          } as SessionEventRow)
        : event,
    );
    render();
    expect(panel.textContent).toContain('Review finished');
    expect(activity.open).toBe(true);
    expect(assignment.open).toBe(true);
  });

  test('follows live child output until the user scrolls up', () => {
    const resize: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      render();
      act(() => inspect().click());
      const transcript = container.querySelector<HTMLElement>(
        '[aria-label="Subagent transcript"]',
      )!;
      Object.defineProperties(transcript, {
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 400 },
      });
      act(() => resize.at(-1)!());
      expect(transcript.scrollTop).toBe(1000);
      transcript.scrollTop = 200;
      act(() => transcript.dispatchEvent(new Event('scroll', { bubbles: true })));
      Object.defineProperty(transcript, 'scrollHeight', { value: 1200, configurable: true });
      act(() => resize.at(-1)!());
      expect(transcript.scrollTop).toBe(200);
      transcript.scrollTop = 800;
      act(() => transcript.dispatchEvent(new Event('scroll', { bubbles: true })));
      Object.defineProperty(transcript, 'scrollHeight', { value: 1400, configurable: true });
      act(() => resize.at(-1)!());
      expect(transcript.scrollTop).toBe(1400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('scopes selection to its session and labels disconnected activity honestly', () => {
    render();
    act(() => inspect().click());
    state.isConnected = false;
    render();
    expect(document.querySelector('[aria-label="Subagent conversation"]')?.textContent).toContain(
      'Disconnected',
    );
    state.sessionId = 'session-b';
    state.events = state.events.map((event) => ({ ...event, sessionId: state.sessionId }));
    render();
    expect(document.querySelector('[aria-label="Subagent conversation"]')).toBeNull();
  });
});
