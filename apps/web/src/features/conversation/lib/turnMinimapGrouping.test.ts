import { describe, it, expect } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { groupConversationTurns, extractTurnSummary } from './turnMinimapGrouping';

describe('turnMinimapGrouping', () => {
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
