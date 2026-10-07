import { describe, it, expect } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { groupConversationTurns, extractTurnSummary, mergeTurnIndex } from './turnMinimapGrouping';

describe('turnMinimapGrouping', () => {
  it('preserves global turn numbers while enriching loaded turns and appending live input', () => {
    const makeEvent = (id: number, content: string): SessionEventRow => ({
      id,
      sessionId: 's',
      type: 'text',
      data: { role: 'user', content },
      createdAt: new Date('2026-10-06T12:00:00Z'),
    });
    const anchors = [1, 3, 5].map((eventId) => ({
      eventId,
      prompt: `Preview ${eventId}`,
      timestamp: '2026-10-06T12:00:00Z',
    }));
    const loaded = groupConversationTurns([
      makeEvent(5, 'Full prompt'),
      { ...makeEvent(6, 'Answer'), type: 'text', data: { role: 'provider', content: 'Answer' } },
      makeEvent(7, 'New input'),
      makeEvent(-1, 'Unsent input'),
    ]);
    const turns = mergeTurnIndex(anchors, loaded, 's');
    expect(turns.map((turn) => [turn.userEvent.id, turn.turnIndex])).toEqual([
      [1, 0],
      [3, 1],
      [5, 2],
      [7, 3],
      [-1, 4],
    ]);
    expect(turns[0].turnSummary).toBe('');
    expect(turns[2].userPrompt).toBe('Full prompt');
    expect(turns[2].turnSummary).toBe('Answer');
  });
  it('keeps an older preview complete before and during partial message loading', () => {
    const anchors = [
      {
        eventId: 1,
        prompt: 'Older question',
        timestamp: '2026-10-06T12:00:00Z',
        summary: 'Complete older answer',
        eventCount: 2,
        diffStats: { additions: 3, deletions: 2, filesCount: 1 },
      },
      {
        eventId: 5,
        prompt: 'Latest question',
        timestamp: '2026-10-06T12:01:00Z',
        summary: 'Saved answer',
        eventCount: 1,
      },
    ];
    const meta = {
      modelName: 'Model',
      providerName: 'Provider',
      providerIcon: '/icon.svg',
      userName: 'You',
    };
    const event = (id: number, role: 'user' | 'provider', content: string): SessionEventRow => ({
      id,
      sessionId: 's',
      type: 'text',
      data: { role, content },
      createdAt: new Date(anchors[0].timestamp),
    });
    const before = mergeTurnIndex(anchors, [], 's', meta)[0];
    const partial = mergeTurnIndex(
      anchors,
      groupConversationTurns(
        [event(1, 'user', 'Older question'), event(2, 'provider', 'Partial answer')],
        undefined,
        meta,
      ),
      's',
      meta,
    )[0];
    const loaded = mergeTurnIndex(
      anchors,
      groupConversationTurns(
        [
          event(1, 'user', 'Older question'),
          event(2, 'provider', 'Partial answer'),
          event(3, 'provider', 'Complete older answer'),
        ],
        undefined,
        meta,
      ),
      's',
      meta,
    )[0];
    const preview = ({
      userPrompt,
      turnSummary,
      diffStats,
      modelName,
      providerName,
      providerIcon,
    }: typeof before) => ({
      userPrompt,
      turnSummary,
      diffStats,
      modelName,
      providerName,
      providerIcon,
    });
    expect(preview(before)).toEqual({
      userPrompt: 'Older question',
      turnSummary: 'Complete older answer',
      diffStats: anchors[0].diffStats,
      modelName: 'Model',
      providerName: 'Provider',
      providerIcon: '/icon.svg',
    });
    expect(preview(partial)).toEqual(preview(before));
    expect(preview(loaded)).toEqual(preview(before));
    const live = mergeTurnIndex(
      anchors,
      groupConversationTurns(
        [event(5, 'user', 'Latest question'), event(6, 'provider', 'Live answer')],
        undefined,
        meta,
      ),
      's',
      meta,
    );
    expect(live[1].turnSummary).toBe('Live answer');
  });
  it('updates a streaming response when a later input is already queued', () => {
    const anchors = [
      {
        eventId: 1,
        prompt: 'First',
        timestamp: '2026-10-06T12:00:00Z',
        summary: 'Saved partial response',
        eventCount: 1,
      },
      {
        eventId: 3,
        prompt: 'Queued',
        timestamp: '2026-10-06T12:01:00Z',
        summary: 'Awaiting agent response...',
        eventCount: 0,
      },
    ];
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'First' },
        metadata: { attemptId: 'first' },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'Queued' },
        createdAt: new Date(),
      },
      {
        id: 4,
        sessionId: 's',
        type: 'text',
        data: { role: 'provider', content: 'Updated streaming response' },
        metadata: { attemptId: 'first' },
        createdAt: new Date(),
      },
    ];
    expect(mergeTurnIndex(anchors, groupConversationTurns(events), 's')[0].turnSummary).toBe(
      'Updated streaming response',
    );
  });
  it('uses captured turn-end statistics for both previous and latest turns', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'First' },
        createdAt: new Date(),
      },
      {
        id: 2,
        sessionId: 's',
        type: 'status',
        data: {
          status: 'turn_end',
          turnChanges: {
            files: [{ path: 'first.ts', additions: 3, deletions: 2 }],
            totalAdditions: 3,
            totalDeletions: 2,
          },
        },
        createdAt: new Date(),
      },
      {
        id: 3,
        sessionId: 's',
        type: 'text',
        data: { role: 'user', content: 'Second' },
        createdAt: new Date(),
      },
      {
        id: 4,
        sessionId: 's',
        type: 'status',
        data: {
          status: 'turn_end',
          turnChanges: {
            files: [{ path: 'second.ts', additions: 5, deletions: 1 }],
            totalAdditions: 5,
            totalDeletions: 1,
          },
        },
        createdAt: new Date(),
      },
    ];
    expect(groupConversationTurns(events).map((turn) => turn.diffStats)).toEqual([
      { additions: 3, deletions: 2, filesCount: 1 },
      { additions: 5, deletions: 1, filesCount: 1 },
    ]);
  });
  it('groups multiple user prompt events into separate ConversationTurns', () => {
    const events: SessionEventRow[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'user', content: 'First question' },
        createdAt: new Date('2026-08-29T04:00:00.000Z'),
      },
      {
        id: 2,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'provider', content: 'First answer paragraph.\n\nSecond paragraph.' },
        createdAt: new Date('2026-08-29T04:00:05.000Z'),
      },
      {
        id: 3,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'user', content: 'Second question' },
        createdAt: new Date('2026-08-29T04:01:00.000Z'),
      },
      {
        id: 4,
        sessionId: 'sess-1',
        type: 'tool_call',
        data: {
          name: 'write_to_file',
          title: 'Writing to file',
          arguments: {
            TargetFile: '/test/foo.ts',
            CodeContent: 'const a = 1;\nconst b = 2;\n',
          },
        },
        createdAt: new Date('2026-08-29T04:01:05.000Z'),
      },
      {
        id: 5,
        sessionId: 'sess-1',
        type: 'text',
        data: { role: 'provider', content: 'Done writing the code.' },
        createdAt: new Date('2026-08-29T04:01:10.000Z'),
      },
    ];

    const turns = groupConversationTurns(events, undefined, {
      modelName: 'GPT-5.6 Sol',
      providerName: 'Zed',
      userName: 'YoussefRnd',
    });

    expect(turns).toHaveLength(2);

    // Turn 1
    expect(turns[0].userPrompt).toBe('First question');
    expect(turns[0].turnSummary).toBe('First answer paragraph.');
    expect(turns[0].modelName).toBe('GPT-5.6 Sol');
    expect(turns[0].userName).toBe('YoussefRnd');
    expect(turns[0].diffStats.additions).toBe(0);

    // Turn 2
    expect(turns[1].userPrompt).toBe('Second question');
    expect(turns[1].turnSummary).toBe('Done writing the code.');
    expect(turns[1].diffStats.additions).toBeGreaterThan(0);
  });

  it('extracts tool action descriptions when no final provider text exists', () => {
    const agentEvents: SessionEventRow[] = [
      {
        id: 10,
        sessionId: 'sess-1',
        type: 'tool_call',
        data: {
          name: 'replace_file_content',
          title: 'Updating config',
        },
        createdAt: new Date('2026-08-29T04:00:00.000Z'),
      },
    ];

    const summary = extractTurnSummary(agentEvents);
    expect(summary).toBe('Executed Updating config');
  });
});
