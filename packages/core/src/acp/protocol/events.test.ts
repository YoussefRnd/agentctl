import { expect, test } from 'vitest';
import { parseNotificationToEvents } from './events.js';

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
