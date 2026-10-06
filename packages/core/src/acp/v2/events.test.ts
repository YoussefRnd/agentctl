import { describe, expect, test } from 'vitest';
import { projectV2SessionUpdate } from './events.js';

describe('ACP v2 event projection', () => {
  test('keeps mixed message content and media placeholders across chunk and replacement updates', () => {
    const content = [
      { type: 'text' as const, text: 'See report' },
      { type: 'resource_link' as const, name: 'Report', uri: 'https://example.com/report' },
      { type: 'resource' as const, resource: { uri: 'file:///report.txt', text: 'Full contents' } },
      { type: 'image' as const, data: 'private-binary', mimeType: 'image/png' },
    ];
    const chunks = content.flatMap((block) =>
      projectV2SessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'message-1',
        content: block,
      }),
    );
    const [replacement] = projectV2SessionUpdate({
      sessionUpdate: 'agent_message',
      messageId: 'message-1',
      content,
    });
    expect(replacement.type).toBe('text');
    if (replacement.type !== 'text') throw new Error('Expected text');
    expect(replacement.text).toBe(
      chunks.map((event) => (event.type === 'text' ? event.text : '')).join(''),
    );
    expect(replacement.text).toContain('https://example.com/report');
    expect(replacement.text).toContain('Full contents');
    expect(replacement.text).toContain('[ACP image (image/png)]');
    expect(replacement.text).not.toContain('private-binary');
    expect(replacement).toMatchObject({ messageId: 'message-1', operation: 'replace' });
  });
  test('preserves message identity and replacement semantics', () => {
    expect(
      projectV2SessionUpdate({
        sessionUpdate: 'agent_message',
        messageId: 'message-1',
        content: [{ type: 'text', text: 'complete' }],
      }),
    ).toEqual([
      {
        type: 'text',
        text: 'complete',
        messageId: 'message-1',
        operation: 'replace',
      },
    ]);
  });

  test('turns tool content chunks into append upserts', () => {
    expect(
      projectV2SessionUpdate({
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 'tool-1',
        content: { type: 'content', content: { type: 'text', text: 'done' } },
      }),
    ).toEqual([
      {
        type: 'tool_call',
        call: {
          toolCallId: 'tool-1',
          content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
        },
        contentOperation: 'append',
      },
    ]);
  });

  test('does not leak v2 metadata into product events', () => {
    expect(
      projectV2SessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'message-2',
        content: { type: 'text', text: 'hello', _meta: { private: true } },
        _meta: { vendor: 'secret' },
      }),
    ).toEqual([
      {
        type: 'text',
        text: 'hello',
        messageId: 'message-2',
        operation: 'append',
      },
    ]);
  });
});

test('preserves generic delegation arguments and arbitrary results in v2 snapshots', () => {
  const [event] = projectV2SessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'opaque',
    name: 'task',
    status: 'completed',
    rawInput: { arguments: { prompt: 'Review files' } },
    rawOutput: ['one', 'two'],
  });
  expect(event).toMatchObject({
    type: 'tool_call',
    call: { name: 'task', arguments: { prompt: 'Review files' }, rawOutput: ['one', 'two'] },
  });
  const [partial] = projectV2SessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'opaque',
    title: 'Finished review',
  });
  expect(partial).toMatchObject({
    type: 'tool_call',
    call: { name: undefined, arguments: undefined },
  });
});

test('preserves cancelled and future plan status and priority values', () => {
  const [update] = projectV2SessionUpdate({
    sessionUpdate: 'plan_update',
    plan: {
      type: 'items',
      planId: 'plan',
      entries: [
        { content: 'Skip', status: 'cancelled', priority: 'low' },
        { content: 'Future', status: 'future_state', priority: 'future_priority' },
      ],
    },
  });
  expect(update).toMatchObject({
    plan: [
      { name: 'Skip', status: 'cancelled', isCompleted: false },
      { name: 'Future', status: 'future_state', priority: 'future_priority', isCompleted: false },
    ],
  });
});
