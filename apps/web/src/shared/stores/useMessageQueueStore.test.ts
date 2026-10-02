import { beforeEach, expect, it } from 'vitest';
import { useMessageQueueStore } from './useMessageQueueStore';

beforeEach(() => {
  localStorage.clear();
  useMessageQueueStore.getState().clearQueue();
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
