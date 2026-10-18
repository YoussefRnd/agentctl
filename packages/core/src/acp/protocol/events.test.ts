import { expect, test } from 'vite-plus/test';
import { parseNotificationToEvents } from './events.js';
import { projectV2SessionUpdate } from '../v2/events.js';

test.each(['v1', 'v2'] as const)(
  'preserves validated retry extension hints and clears for %s',
  (version) => {
    const project = (meta: Record<string, unknown>) => {
      const update = { sessionUpdate: 'session_info_update' as const, _meta: meta };
      return version === 'v1'
        ? parseNotificationToEvents({ sessionId: 's', update })
        : projectV2SessionUpdate(update);
    };
    expect(
      project({
        'opencode/retry': {
          attempt: 2,
          nextRetryAt: '2026-10-05T13:59:09.425Z',
          error: {
            type: 'provider.internal',
            message: 'Provider request failed with HTTP 504',
            status: 504,
          },
        },
        private: 'opaque',
      }),
    ).toEqual([
      expect.objectContaining({
        retry: {
          attempt: 2,
          nextRetryAt: '2026-10-05T13:59:09.425Z',
          message: 'Provider request failed with HTTP 504',
          httpStatus: 504,
        },
      }),
    ]);
    expect(project({ 'opencode/retry': null })).toEqual([expect.objectContaining({ retry: null })]);
    for (const value of [
      {},
      { attempt: 2, nextRetryAt: 'invalid', error: { message: 'bad' } },
      { attempt: -1 },
    ]) {
      expect(project({ 'vendor/retry': value })[0]).not.toHaveProperty('retry');
    }
    expect(JSON.stringify(project({ private: 'opaque' }))).not.toContain('opaque');
  },
);

test('retains ACP resource links and embedded text in the conversation', () => {
  const contents = [
    {
      type: 'resource_link' as const,
      name: 'Report',
      uri: 'https://example.com/report',
      description: 'Results',
    },
    {
      type: 'resource' as const,
      resource: { uri: 'file:///report.txt', text: 'Full report contents', mimeType: 'text/plain' },
    },
  ];
  const texts = contents.flatMap((content) =>
    parseNotificationToEvents({
      sessionId: 's1',
      update: { sessionUpdate: 'agent_message_chunk', content },
    }),
  );
  expect(texts).toEqual([
    { type: 'text', text: '\n\nReport: Results\nhttps://example.com/report\n\n' },
    { type: 'text', text: 'Full report contents' },
  ]);
});

test('renders unsupported media placeholders without persisting binary data', () => {
  for (const content of [
    {
      type: 'image' as const,
      data: 'secret-base64',
      mimeType: 'image/png',
      uri: 'data:image/png;base64,secret-base64',
    },
    { type: 'audio' as const, data: 'secret-base64', mimeType: 'audio/wav' },
    {
      type: 'resource' as const,
      resource: {
        uri: 'file:///asset',
        blob: 'secret-base64',
        mimeType: 'application/octet-stream',
      },
    },
  ]) {
    const events = parseNotificationToEvents({
      sessionId: 's1',
      update: { sessionUpdate: 'agent_message_chunk', content },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).toContain('[ACP ');
    expect(JSON.stringify(events)).not.toContain('secret-base64');
  }
});

test('projects meaningful command metadata without exposing the protocol metadata bag', () => {
  const events = parseNotificationToEvents({
    sessionId: 's1',
    update: {
      sessionUpdate: 'available_commands_update',
      _meta: { vendor_private: 'opaque' },
      availableCommands: [
        {
          name: 'review',
          description: 'Review changes',
          _meta: { command_category: 'workflow', vendor_private: true },
        },
      ],
    },
  });
  expect(events).toEqual([
    {
      type: 'available_commands_update',
      commands: [
        { name: 'review', description: 'Review changes', category: 'workflow', input: undefined },
      ],
    },
  ]);
});

test('does not copy notification metadata onto text events', () => {
  expect(
    parseNotificationToEvents({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
        _meta: { private: true },
      },
    }),
  ).toEqual([{ type: 'text', text: 'Hello' }]);
});

test('v1 partial updates preserve previously reported name, arguments, and output when omitted or null', () => {
  const [event] = parseNotificationToEvents({
    sessionId: 's1',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'opaque',
      name: null,
      rawInput: null,
      rawOutput: null,
      title: 'Progress',
    },
  });
  expect(event).toMatchObject({
    type: 'tool_call',
    call: {
      toolCallId: 'opaque',
      name: undefined,
      arguments: undefined,
      rawInput: undefined,
      rawOutput: undefined,
      title: 'Progress',
    },
  });
});

test('an empty config_option_update clears the advertised configuration options', () => {
  expect(
    parseNotificationToEvents({
      sessionId: 's',
      update: { sessionUpdate: 'config_option_update', configOptions: [] },
    }),
  ).toEqual([{ type: 'config_option_update', configOptions: [] }]);
});
