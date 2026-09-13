import { describe, expect, test } from 'vitest';
import { projectV2SessionUpdate } from './events.js';

describe('ACP v2 event projection', () => {
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
