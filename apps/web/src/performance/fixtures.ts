import type { SessionEventRow } from '@agentctl/shared';

export const FIXTURE_VERSION = 1;
const paragraph =
  'Review the workspace — preserve café, العربية, 中文, and 👩🏽‍💻. Keep finished paragraphs stable while the agent streams the next section.\n\n';
const codeTable = [
  paragraph,
  '```typescript\nexport function summarize(values: number[]) {\n  return values.reduce((total, value) => total + value, 0);\n}\n```\n\n',
  '| File | Status | Change |\n| --- | --- | --- |\n| composer.tsx | ready | preserve drafts |\n| feed.tsx | ready | reduce repeated work |\n\n',
].join('');

export function markdownFixture(kind: 'plain' | 'code-table', targetLength: number): string {
  const block = kind === 'plain' ? paragraph : codeTable;
  // Whole blocks keep code fences and tables valid at both fixture sizes.
  return block.repeat(Math.ceil(targetLength / block.length));
}

export function conversationFixture(eventCount: number, toolsPerTurn = 1): SessionEventRow[] {
  const events: SessionEventRow[] = [];
  const createdAt = new Date('2026-01-01T00:00:00Z');
  const add = (event: Omit<SessionEventRow, 'id' | 'sessionId' | 'createdAt'>) => {
    events.push({
      ...event,
      id: events.length + 1,
      sessionId: '00000000-0000-4000-8000-000000000001',
      createdAt,
    } as SessionEventRow);
  };
  while (events.length < eventCount) {
    const parentEventId = events.length + 1;
    add({ type: 'text', data: { role: 'user', content: `Review turn ${parentEventId}` } });
    add({ type: 'text', parentEventId, data: { role: 'thought', content: paragraph } });
    for (let tool = 0; tool < toolsPerTurn; tool++) {
      add({
        type: 'tool_call',
        parentEventId,
        data: {
          toolCallId: `tool-${events.length + 1}`,
          title: 'Read workspace file',
          kind: 'read',
          status: 'completed',
          content: [],
        },
      });
    }
    add({ type: 'text', parentEventId, data: { role: 'provider', content: paragraph } });
    add({ type: 'status', parentEventId, data: { status: 'turn_end' } });
  }
  return events.slice(0, eventCount);
}
