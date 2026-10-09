import { expect, test } from 'vitest';
import type { SessionEventRow } from '@agentctl/shared';
import { orderConversationEvents } from './orderConversationEvents';
import { groupFeedEvents } from './eventFeedGrouping';
import { groupConversationTurns } from './turnMinimapGrouping';

function row(
  id: number,
  type: string,
  data: unknown,
  parentEventId?: number,
  attemptId?: string,
): SessionEventRow {
  return {
    id,
    sessionId: 's',
    type,
    data,
    parentEventId,
    metadata: attemptId ? { attemptId } : undefined,
    createdAt: new Date(),
  } as SessionEventRow;
}

test('keeps interleaved output and errors with the failed attempt instead of queued inputs', () => {
  const events = [
    row(1, 'text', { role: 'user', content: 'first' }, undefined, 'a'),
    row(2, 'text', { role: 'user', content: 'queued' }, undefined, 'b'),
    row(3, 'tool_call', { toolCallId: 'tool' }, 1, 'a'),
    row(4, 'text', { role: 'provider', content: 'partial' }, 3),
    row(5, 'status', { status: 'prompt_failed', message: 'first failed' }, 1, 'a'),
    row(6, 'text', { role: 'provider', content: 'second output' }, 2, 'b'),
  ];
  expect(orderConversationEvents(events).map((event) => event.id)).toEqual([1, 3, 4, 5, 2, 6]);
  const groups = groupFeedEvents(events, null, false);
  expect(groups.map((group) => group.type)).toEqual(['user', 'agent', 'error', 'user', 'agent']);
  const turns = groupConversationTurns(events);
  expect(turns[0].agentEvents.map((event) => event.id)).toEqual([3, 4, 5]);
  expect(turns[1].agentEvents.map((event) => event.id)).toEqual([6]);
});

test('uses attempt identity when the error has no parent and retains legacy ordering', () => {
  const events = [
    row(1, 'text', { role: 'user', content: 'first' }, undefined, 'a'),
    row(2, 'text', { role: 'user', content: 'second' }, undefined, 'b'),
    row(3, 'status', { status: 'prompt_failed' }, undefined, 'a'),
  ];
  expect(orderConversationEvents(events).map((event) => event.id)).toEqual([1, 3, 2]);
  const legacy = events.map((event) => ({ ...event, metadata: undefined }));
  expect(orderConversationEvents(legacy).map((event) => event.id)).toEqual([1, 2, 3]);
});

test('does not assign missing or cyclic parent references to an unrelated input', () => {
  const events = [
    row(1, 'text', { role: 'user', content: 'current' }),
    row(2, 'status', { status: 'prompt_failed' }, 999, 'missing'),
    row(3, 'status', { status: 'prompt_failed' }, 4),
    row(4, 'status', { status: 'other' }, 3),
  ];
  expect(orderConversationEvents(events).map((event) => event.id)).toEqual([2, 3, 4, 1]);
});

test('does not create a separate conversation turn for a native child transcript', () => {
  const child = row(3, 'text', { role: 'user', content: 'child task' }, 1, 'a');
  child.metadata = { ...child.metadata, nativeSessionId: 'child-session' };
  const events = [
    row(1, 'text', { role: 'user', content: 'first' }, undefined, 'a'),
    row(2, 'text', { role: 'user', content: 'queued' }, undefined, 'b'),
    child,
    row(4, 'status', { status: 'prompt_failed', message: 'first failed' }, undefined, 'a'),
  ];
  expect(groupConversationTurns(events).map((turn) => turn.userEvent.id)).toEqual([1, 2]);
  expect(groupFeedEvents(events, null).map((group) => group.type)).toEqual([
    'user',
    'error',
    'user',
  ]);
});

test('keeps queued and cancelled input out of the chat and minimap until dispatch', () => {
  const active = row(
    1,
    'text',
    { role: 'user', content: 'active', deliveryStatus: 'accepted' },
    undefined,
    'a',
  );
  const waiting = row(
    2,
    'text',
    { role: 'user', content: 'waiting', deliveryStatus: 'queued' },
    undefined,
    'b',
  );
  const events = [
    active,
    waiting,
    row(3, 'text', { role: 'provider', content: 'still responding' }, 1, 'a'),
    row(4, 'text', { role: 'user', content: 'removed', deliveryStatus: 'cancelled' }),
    row(-1, 'text', { role: 'user', content: 'unsent', deliveryStatus: 'failed' }),
  ];
  expect(orderConversationEvents(events).map((event) => event.id)).toEqual([1, 3]);
  expect(groupFeedEvents(events, 3, true).map((group) => group.type)).toEqual(['user', 'agent']);
  expect(groupConversationTurns(events).map((turn) => turn.userEvent.id)).toEqual([1]);
  expect(waiting.data).toMatchObject({ deliveryStatus: 'queued' });
  const dispatched = events.map((event) =>
    event === waiting
      ? ({ ...waiting, data: { ...waiting.data, deliveryStatus: 'accepted' } } as SessionEventRow)
      : event,
  );
  expect(
    groupFeedEvents(dispatched, null)
      .filter((group) => group.type === 'user')
      .map((group) => group.event.id),
  ).toEqual([1, 2]);
  expect(groupConversationTurns(dispatched).map((turn) => turn.userEvent.id)).toEqual([1, 2]);
});

test('retains immediate optimistic input and failed dispatched turns in chat', () => {
  const events = [
    row(1, 'text', { role: 'user', content: 'failed turn', deliveryStatus: 'failed' }),
    row(-1, 'text', { role: 'user', content: 'immediate send', deliveryStatus: 'sending' }),
  ];
  expect(orderConversationEvents(events).map((event) => event.id)).toEqual([1, -1]);
});
