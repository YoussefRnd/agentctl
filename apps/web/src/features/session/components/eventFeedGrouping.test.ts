import { describe, it, expect } from 'vitest';
import { groupFeedEvents } from './eventFeedGrouping';
import type { ACPEventRow } from '@agentctl/shared';

describe('groupFeedEvents', () => {
  it('does not create an agent turn for standalone system status events (e.g. process exit SIGTERM)', () => {
    const events: ACPEventRow[] = [
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
    const events: ACPEventRow[] = [
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
    const events: ACPEventRow[] = [
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
    const events: ACPEventRow[] = [
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
    const events: ACPEventRow[] = [
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
