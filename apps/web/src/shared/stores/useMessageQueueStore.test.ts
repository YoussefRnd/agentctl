import { beforeEach, expect, it } from 'vitest';
import { useMessageQueueStore } from './useMessageQueueStore';

beforeEach(() => {
  localStorage.clear();
  useMessageQueueStore.getState().clearQueue();
});

it('keeps a waiting message visible in the chatbox while it is being forwarded', () => {
  const queue = useMessageQueueStore.getState();
  queue.enqueueMessage('s', 'follow-up', undefined, -1, 'waiting');
  queue.setMessageStatus('s', 'waiting', 'sending');
  expect(useMessageQueueStore.getState().queuedMessages.s[0]).toMatchObject({
    status: 'sending',
    waiting: true,
  });
});

it('prevents moving sending or uncertain messages and edits only waiting messages', () => {
  const queue = useMessageQueueStore.getState();
  queue.enqueueMessage('s', 'sending', ['image'], -1, 'sending', 'sending');
  queue.enqueueMessage('s', 'waiting', ['image-2'], -2, 'waiting');
  queue.moveQueuedMessage('s', 1, 'up');
  expect(useMessageQueueStore.getState().queuedMessages.s.map((item) => item.id)).toEqual([
    'sending',
    'waiting',
  ]);
  expect(queue.editMessage('s', 'sending', 'changed')).toBe(false);
  expect(queue.editMessage('s', 'waiting', ' updated ')).toBe(true);
  expect(useMessageQueueStore.getState().queuedMessages.s[1]).toMatchObject({
    id: 'waiting',
    text: 'updated',
    attachmentIds: ['image-2'],
    optimisticEventId: -2,
  });
  queue.setMessageStatus('s', 'waiting', 'unknown');
  expect(queue.editMessage('s', 'waiting', 'changed')).toBe(false);
});

it('restores interrupted sends with the same receipt ID and keeps failures paused', async () => {
  const queue = useMessageQueueStore.getState();
  const id = queue.enqueueMessage('session-1', 'first', ['attachment'], -1);
  queue.setMessageStatus('session-1', id, 'sending');
  const failed = queue.enqueueMessage('session-2', 'second');
  queue.setMessageStatus('session-2', failed, 'failed', 'offline');
  const saved = localStorage.getItem('agentctl-message-outbox')!;
  queue.clearQueue();
  localStorage.setItem('agentctl-message-outbox', saved);
  await useMessageQueueStore.persist.rehydrate();
  expect(useMessageQueueStore.getState().queuedMessages['session-1']).toEqual([
    expect.objectContaining({ id, attachmentIds: ['attachment'], status: 'queued' }),
  ]);
  expect(useMessageQueueStore.getState().queuedMessages['session-2'][0]).toMatchObject({
    id: failed,
    status: 'failed',
    error: 'offline',
  });
});
