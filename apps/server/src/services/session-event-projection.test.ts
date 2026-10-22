import { expect, it, vi } from 'vite-plus/test';
import {
  sessionEventRowSchema,
  normalizeFileChanges,
  type SessionEventRow,
} from '@agentctl/shared';
import {
  compactHistoryEvent,
  eventDetailRevision,
  SessionEventProjection,
} from './session-event-projection.js';
function tool(data: Record<string, unknown>): SessionEventRow {
  return sessionEventRowSchema.parse({
    id: 1,
    sessionId: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date('2026-01-01'),
    type: 'tool_call',
    metadata: { nativeSessionId: 'child', durationMs: 5 },
    data: { name: 'read', kind: 'read', status: 'completed', ...data },
  });
}
it('defers tool bodies while preserving headers, routing, inputs, terminal references and file summaries', () => {
  const row = tool({
    arguments: { path: '/a' },
    rawInput: { path: '/a' },
    rawOutput: 'huge output',
    content: [
      { type: 'content', content: { text: 'huge output' } },
      { type: 'diff', path: '/a', oldText: 'a\nb', newText: 'c\nd\ne' },
      { type: 'terminal', terminalId: 't' },
    ],
    effects: [{ type: 'file_modified', path: '/b', oldText: 'one', newText: 'two\nthree' }],
  });
  const before = JSON.stringify(row);
  const compact = compactHistoryEvent(row);
  expect(compact.details?.revision).toBe(eventDetailRevision(row));
  expect(compact.data).toMatchObject({
    name: 'read',
    status: 'completed',
    arguments: { path: '/a' },
    rawInput: { path: '/a' },
    content: [
      { type: 'diff', path: '/a', stats: { additions: 3, deletions: 2 } },
      { type: 'terminal', terminalId: 't' },
    ],
    effects: [{ type: 'file_modified', path: '/b', stats: { additions: 2, deletions: 1 } }],
  });
  expect(JSON.stringify(compact)).not.toContain('huge output');
  expect(compact.metadata).toEqual(row.metadata);
  expect(JSON.stringify(row)).toBe(before);
  expect(sessionEventRowSchema.parse(compact)).toEqual(compact);
  expect(compactHistoryEvent(compact)).toBe(compact);
});
it('preserves structured multi-file operations and stats after omitting patches', () => {
  const compact = compactHistoryEvent(
    tool({
      kind: 'edit',
      content: [
        {
          type: 'diff',
          changes: [{ operation: 'modify', path: '/a' }],
          patch: { format: 'git_patch', text: '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new' },
        },
      ],
    }),
  );
  expect(compact.type === 'tool_call' && compact.data.fileChanges).toEqual([
    { operation: 'modify', path: '/a', stats: { additions: 1, deletions: 1 } },
  ]);
  expect(JSON.stringify(compact)).not.toContain('-old');
});
it('keeps delegation, active tools, approvals, messages and unknown tools complete', () => {
  for (const row of [
    tool({ name: 'task', kind: 'other', rawOutput: 'result' }),
    tool({ status: 'in_progress', rawOutput: 'stream' }),
    tool({ name: 'custom', kind: 'other', rawOutput: 'opaque' }),
    tool({
      kind: 'execute',
      arguments: { arguments: { agent_type: 'reviewer', prompt: 'review' } },
      rawOutput: 'delegation result',
    }),
  ])
    expect(compactHistoryEvent(row)).toBe(row);
  const text = sessionEventRowSchema.parse({
    id: 2,
    sessionId: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date(),
    type: 'text',
    data: { role: 'provider', content: 'full answer' },
  });
  expect(compactHistoryEvent(text)).toBe(text);
});
it('defers terminal output without losing append/replace identity and invalidates revisions on every content change', () => {
  const row = sessionEventRowSchema.parse({
    id: 2,
    sessionId: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date(),
    type: 'terminal_output',
    data: { terminalId: 't', operation: 'replace', data: 'full terminal output' },
  });
  expect(compactHistoryEvent(row)).toMatchObject({
    details: { revision: eventDetailRevision(row) },
    data: { terminalId: 't', operation: 'replace', data: '' },
  });
  if (row.type !== 'terminal_output') throw new Error('Expected terminal');
  expect(eventDetailRevision({ ...row, data: { ...row.data, data: 'updated' } })).not.toBe(
    eventDetailRevision(row),
  );
  expect(eventDetailRevision({ ...row, sequence: 4 })).toBe(eventDetailRevision(row));
});

it('preserves an empty structured summary so unfamiliar operations are not inferred as edits', () => {
  const row = compactHistoryEvent(
    tool({
      kind: 'edit',
      arguments: { path: '/file' },
      content: [{ type: 'diff', changes: [{ operation: 'future', path: '/file' }] }],
    }),
  );
  expect(row.type === 'tool_call' && row.data.fileChanges).toEqual([]);
});

it('keeps delegation results when routing arguments are JSON encoded', () => {
  const argumentsJson = JSON.stringify({ agent_type: 'reviewer', prompt: 'review changes' });
  for (const input of [{ rawInput: argumentsJson }, { arguments: { arguments: argumentsJson } }]) {
    const row = tool({ name: 'custom', kind: 'execute', rawOutput: 'delegated result', ...input });
    expect(compactHistoryEvent(row)).toBe(row);
  }
});

it('reuses only derived diff summaries, invalidates changed patches, and isolates returned objects', () => {
  const compute = vi.fn((diff: Parameters<typeof normalizeFileChanges>[0]) =>
    normalizeFileChanges(diff),
  );
  const projector = new SessionEventProjection(compute);
  const row = tool({
    kind: 'edit',
    content: [
      {
        type: 'diff',
        changes: [{ operation: 'modify', path: '/file' }],
        patch: { format: 'git_patch', text: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new' },
      },
    ],
  });
  const first = projector.compact(row);
  if (first.type !== 'tool_call') throw new Error('Expected tool');
  first.data.fileChanges![0].path = 'mutated';
  const second = projector.compact({ ...row, id: 2 });
  expect(second.type === 'tool_call' && second.data.fileChanges?.[0].path).toBe('/file');
  expect(compute).toHaveBeenCalledTimes(1);
  if (row.type !== 'tool_call') throw new Error('Expected tool');
  projector.compact({
    ...row,
    data: {
      ...row.data,
      content: [{ type: 'diff', changes: [{ operation: 'delete', path: '/file' }] }],
    },
  });
  expect(compute).toHaveBeenCalledTimes(2);
});

it('evicts old summaries and skips large summaries rather than retaining unbounded history', () => {
  const compute = vi.fn((diff: Parameters<typeof normalizeFileChanges>[0]) =>
    normalizeFileChanges(diff),
  );
  const projector = new SessionEventProjection(compute);
  const row = (path: string) =>
    tool({ kind: 'edit', content: [{ type: 'diff', changes: [{ operation: 'modify', path }] }] });
  for (let i = 0; i < 1100; i++) projector.compact(row(String(i)));
  projector.compact(row('1099'));
  expect(compute).toHaveBeenCalledTimes(1100);
  projector.compact(row('0'));
  expect(compute).toHaveBeenCalledTimes(1101);
  projector.compact(row('x'.repeat(5000)));
  projector.compact(row('x'.repeat(5000)));
  expect(compute).toHaveBeenCalledTimes(1103);
  // The total-character budget also evicts entries before the count limit is reached.
  const long = (i: number) => String(i) + '/'.repeat(1000);
  for (let i = 0; i < 300; i++) projector.compact(row(long(i)));
  const count = compute.mock.calls.length;
  projector.compact(row(long(0)));
  expect(compute).toHaveBeenCalledTimes(count + 1);
});

it('compacts ordinary file titles containing agent/task words while preserving real delegation titles', () => {
  const row = tool({
    title: 'Read agentctl/tasks.ts',
    arguments: { path: '/agentctl/tasks.ts' },
    rawOutput: 'file output',
  });
  expect(compactHistoryEvent(row).details).toBeDefined();
  for (const title of ['Task', 'Running Task', 'builtin__invoke_subagents']) {
    const delegated = tool({
      name: 'custom',
      kind: 'execute',
      title,
      rawOutput: 'delegated result',
    });
    expect(compactHistoryEvent(delegated)).toBe(delegated);
  }
});

it('keeps partial output complete when a tracked tool has not reported a final status', () => {
  const row = tool({ status: undefined, rawOutput: 'partial output' });
  expect(compactHistoryEvent(row)).toBe(row);
});
