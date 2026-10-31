import { describe, it, expect } from 'vite-plus/test';
import { groupFeedEvents, hasCurrentChatFailure } from './eventFeedGrouping';
import { providerErrorCopy, type ChatError, type SessionEventRow } from '@agentctl/shared';

const failure: ChatError = {
  version: 1,
  id: 'attempt:one:failure',
  category: 'authentication',
  scope: 'attempt',
  stage: 'dispatch',
  delivery: 'rejected',
  message: providerErrorCopy('authentication').message,
  attemptId: 'one',
  eventId: 1,
  actions: ['provider_settings', 'retry'],
};

it('deduplicates structured failures by identity, even when runtime text differs', () => {
  const events: SessionEventRow[] = [
    {
      id: 1,
      sessionId: 's',
      type: 'text',
      data: { role: 'user', content: 'hey' },
      createdAt: new Date(),
    },
    {
      id: 2,
      sessionId: 's',
      type: 'status',
      data: { status: 'runtime_error', error: failure, title: 'Process closed' },
      createdAt: new Date(),
    },
    {
      id: 3,
      sessionId: 's',
      type: 'status',
      data: { status: 'prompt_failed', error: failure },
      parentEventId: 1,
      createdAt: new Date(),
    },
    {
      id: 4,
      sessionId: 's',
      type: 'status',
      data: { status: 'prompt_failed', error: failure },
      parentEventId: 1,
      createdAt: new Date(),
    },
  ];
  const groups = groupFeedEvents(events, null);
  expect(groups.map((group) => group.type)).toEqual(['user', 'error']);
  expect('event' in groups[1] && groups[1].event.id).toBe(4);
});

it('keeps independent structured failures with identical wording separate', () => {
  const events: SessionEventRow[] = ['one', 'two'].map((attemptId, index) => ({
    id: index + 1,
    sessionId: 's',
    type: 'status',
    createdAt: new Date(),
    data: {
      status: 'prompt_failed',
      error: { ...failure, id: `attempt:${attemptId}:failure`, attemptId },
    },
  }));
  expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual(['error', 'error']);
});

it('does not surface diagnostic-only lifecycle events as another failure', () => {
  const events: SessionEventRow[] = [
    {
      id: 1,
      sessionId: 's',
      type: 'status',
      data: { status: 'runtime_error', error: failure, diagnosticOnly: true },
      createdAt: new Date(),
    },
  ];
  expect(groupFeedEvents(events, null)).toEqual([]);
});

it('does not let a historical error hide the current failure fallback', () => {
  const events: SessionEventRow[] = [
    {
      id: 1,
      sessionId: 's',
      type: 'status',
      data: { status: 'prompt_failed', error: failure },
      createdAt: new Date(),
    },
    {
      id: 2,
      sessionId: 's',
      type: 'text',
      data: { role: 'user', content: 'new turn' },
      createdAt: new Date(),
    },
  ];
  const groups = groupFeedEvents(events, null);
  expect(hasCurrentChatFailure(groups)).toBe(false);
  const execution = {
    connection: 'lost' as const,
    execution: 'failed' as const,
    attention: 'error' as const,
    queue: [],
    error: { ...failure, id: 'new-failure' },
  };
  expect(hasCurrentChatFailure(groups, execution)).toBe(false);
  expect(hasCurrentChatFailure(groups, { ...execution, error: failure })).toBe(true);
});

describe('groupFeedEvents', () => {
  it('shows one error when a connection closes before the prompt executor can record failure', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'hey' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's',
        type: 'status',
        data: { status: 'runtime_error', title: 'Connection closed' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 's',
        type: 'status',
        parentEventId: 1,
        data: { status: 'operation_failed', message: 'Connection closed' },
        createdAt: new Date(),
      },
    ];
    expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual(['user', 'error']);
  });

  it('does not let a hidden child failure suppress a parent runtime error', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'hey' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's',
        type: 'status',
        parentEventId: 1,
        metadata: { nativeSessionId: 'child' },
        data: { status: 'prompt_failed', message: 'Child failed' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 's',
        type: 'status',
        data: { status: 'runtime_error', title: 'Parent disconnected' },
        createdAt: new Date(),
      },
    ];
    expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual(['user', 'notice']);
  });

  it.each([false, true])(
    'shows one rejection instead of duplicate runtime and worker failures (correlated=%s)',
    (correlated) => {
      const metadata = correlated ? { attemptId: 'attempt' } : undefined;
      const events: SessionEventRow[] = [
        {
          id: 1,
          sessionId: 's',
          type: 'text',
          data: { role: 'user', content: 'hey' },
          metadata,
          createdAt: new Date(),
        },
        {
          id: 2,
          sessionId: 's',
          type: 'status',
          parentEventId: 1,
          data: { status: 'prompt_failed', message: 'Authentication required' },
          metadata,
          createdAt: new Date(),
        },
        {
          id: 3,
          sessionId: 's',
          type: 'status',
          data: { status: 'runtime_error', title: 'Authentication required' },
          metadata,
          createdAt: new Date(),
        },
        {
          id: 4,
          sessionId: 's',
          type: 'status',
          parentEventId: 1,
          data: { status: 'operation_failed', message: 'Authentication required' },
          createdAt: new Date(),
        },
      ];
      expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual(['user', 'error']);
    },
  );

  it('keeps startup failures and independent runtime failures visible', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'hey' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's',
        type: 'status',
        parentEventId: 1,
        data: { status: 'operation_failed', message: 'Authentication required' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'next' },
        createdAt: new Date(),
      },
      {
        id: 4,
        sessionId: 's',
        type: 'status',
        data: { status: 'runtime_error', title: 'Connection closed' },
        createdAt: new Date(),
      },
    ];
    expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual([
      'user',
      'error',
      'user',
      'notice',
    ]);
  });

  it('does not create an agent turn for standalone system status events (e.g. process exit SIGTERM)', () => {
    const events: SessionEventRow[] = [
      {
        id: 2423,
        sessionId: 'sess-1',
        type: 'status',
        data: {
          status: 'error',
          title: 'Agent process exited with code SIGTERM',
        },
        createdAt: new Date(),
      },
    ];

    const groups = groupFeedEvents(events, null, false);
    expect(groups).toHaveLength(0);
  });

  it('filters out hidden system events', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        type: 'status',
        data: { status: 'turn_end' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 'sess-1',
        type: 'status',
        data: { status: 'available_commands_update' },
        createdAt: new Date(),
      },
    ];

    const groups = groupFeedEvents(events, null, false);
    expect(groups).toHaveLength(0);
  });

  it('correctly groups user messages and agent turns', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'user', content: 'Hello agent' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'thought', content: 'Thinking about greetings...' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'provider', content: 'Hello! How can I help you today?' },
        createdAt: new Date(),
      },
    ];

    const groups = groupFeedEvents(events, null, false);
    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe('user');
    expect(groups[1].type).toBe('agent');
    if (groups[1].type === 'agent') {
      expect(groups[1].events).toHaveLength(2);
    }
  });

  it('appends mid-turn status events to an active agent turn', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'user', content: 'Do something' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'thought', content: 'Working...' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 'sess-1',
        type: 'status',
        data: { status: 'step_started' },
        createdAt: new Date(),
      },
    ];

    const groups = groupFeedEvents(events, null, false);
    expect(groups).toHaveLength(2);
    expect(groups[1].type).toBe('agent');
    if (groups[1].type === 'agent') {
      expect(groups[1].events).toHaveLength(2);
      expect(groups[1].events[1].id).toBe(3);
    }
  });

  it('appends turn_end status event to an active agent turn so turnChanges are preserved', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'user', content: 'Inspect files' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'thought', content: 'Looking around...' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 'sess-1',
        type: 'status',
        data: {
          status: 'turn_end',
          turnChanges: { files: [], totalAdditions: 0, totalDeletions: 0 },
        },
        createdAt: new Date(),
      },
    ];

    const groups = groupFeedEvents(events, null, false);
    expect(groups).toHaveLength(2);
    expect(groups[1].type).toBe('agent');
    if (groups[1].type === 'agent') {
      expect(groups[1].events).toHaveLength(2);
      expect(groups[1].events[1].id).toBe(3);
      expect((groups[1].events[1].data as { status?: string }).status).toBe('turn_end');
    }
  });
});

it('shows model fallback notices even before the first conversation turn', () => {
  const event: SessionEventRow = {
    id: 1,
    sessionId: 'session',
    type: 'status',
    data: { status: 'model_fallback', title: 'Model “old” is unavailable. Using “new”.' },
    createdAt: new Date(),
  };
  expect(groupFeedEvents([event], null)).toEqual([{ type: 'notice', event, isStreaming: false }]);
});

it('keeps a provider switch between turns as a standalone timeline row', () => {
  const events: SessionEventRow[] = [
    {
      id: 1,
      sessionId: 's',
      createdAt: new Date(),
      type: 'text',
      data: { role: 'user', content: 'First request' },
    },
    {
      id: 2,
      sessionId: 's',
      createdAt: new Date(),
      type: 'text',
      parentEventId: 1,
      data: { role: 'provider', content: 'First reply' },
    },
    {
      id: 3,
      sessionId: 's',
      createdAt: new Date(),
      type: 'status',
      data: {
        status: 'provider_switched',
        from: { providerId: 'codex', providerName: 'Codex', modelId: 'model-a' },
        to: { providerId: 'claude', providerName: 'Claude Code', modelId: 'model-b' },
      },
    },
    {
      id: 4,
      sessionId: 's',
      createdAt: new Date(),
      type: 'text',
      data: { role: 'user', content: 'Next request' },
    },
  ];
  const icons = new Map([
    ['codex', 'https://cdn.example.com/codex.svg'],
    ['claude', 'https://cdn.example.com/claude.svg'],
  ]);
  const grouped = groupFeedEvents(events, null, true, icons);
  expect(grouped.map((group) => group.type)).toEqual([
    'user',
    'agent',
    'provider_switch',
    'user',
    'agent',
  ]);
  expect('event' in grouped[2] && grouped[2].event.id).toBe(3);
  if (grouped[2].type === 'provider_switch') {
    expect(grouped[2].change.from.providerIcon).toBe(icons.get('codex'));
    expect(grouped[2].change.to.providerIcon).toBe(icons.get('claude'));
  }
  expect(groupFeedEvents([events[2]], null)).toHaveLength(1);
});

it('preserves the recorded provider icon when registry branding changes', () => {
  const event: SessionEventRow = {
    id: 1,
    sessionId: 's',
    createdAt: new Date(),
    type: 'status',
    data: {
      status: 'provider_switched',
      from: {
        providerId: 'codex',
        providerName: 'Codex',
        providerIcon: 'https://cdn.example.com/original-codex.svg',
        modelId: 'default',
      },
      to: { providerId: 'claude', providerName: 'Claude Code', modelId: 'default' },
    },
  };
  const [group] = groupFeedEvents(
    [event],
    null,
    false,
    new Map([
      ['codex', 'https://cdn.example.com/new-codex.svg'],
      ['claude', 'https://cdn.example.com/claude.svg'],
    ]),
  );
  expect(group.type).toBe('provider_switch');
  if (group.type === 'provider_switch') {
    expect(group.change.from.providerIcon).toBe('https://cdn.example.com/original-codex.svg');
    expect(group.change.to.providerIcon).toBe('https://cdn.example.com/claude.svg');
  }
});
