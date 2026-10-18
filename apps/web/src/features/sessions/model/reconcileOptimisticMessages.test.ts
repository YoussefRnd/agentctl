import { describe, expect, it } from 'vite-plus/test';
import type { SessionEventRow } from '@agentctl/shared';
import { reconcileOptimisticMessages } from './reconcileOptimisticMessages';

const testDate = new Date('2026-01-01T00:00:00Z');

function message(
  id: number,
  content: string,
  deliveryStatus?: 'queued' | 'sending',
): SessionEventRow {
  return {
    id,
    sessionId: '00000000-0000-0000-0000-000000000001',
    type: 'text',
    data: { role: 'user', content, deliveryStatus },
    createdAt: testDate,
  } as SessionEventRow;
}

describe('reconcileOptimisticMessages', () => {
  it('uses receipt IDs to distinguish identical prompts and recover a lost acknowledgment', () => {
    const first = {
      ...message(-1, 'repeat'),
      data: {
        role: 'user' as const,
        content: 'repeat',
        clientMessageId: 'first',
        deliveryStatus: 'failed' as const,
      },
    } as SessionEventRow;
    const second = {
      ...message(-2, 'repeat', 'queued'),
      data: {
        role: 'user' as const,
        content: 'repeat',
        clientMessageId: 'second',
        deliveryStatus: 'queued' as const,
      },
    } as SessionEventRow;
    const receipt = {
      ...message(10, 'repeat'),
      data: { role: 'user' as const, content: 'repeat', clientMessageId: 'first' },
    } as SessionEventRow;
    expect(reconcileOptimisticMessages([first, second], [receipt])).toEqual([receipt, second]);
    const unrelated = {
      ...receipt,
      id: 11,
      data: { ...receipt.data, clientMessageId: 'third' },
    } as SessionEventRow;
    expect(reconcileOptimisticMessages([second], [unrelated])).toEqual([second]);
  });
  it('replaces each queued prompt with its matching persisted message', () => {
    const existing = [message(-1, 'first', 'sending'), message(-2, 'second', 'queued')];
    const incoming = [message(10, 'first'), message(11, 'second')];
    expect(reconcileOptimisticMessages(existing, incoming)).toEqual(incoming);
  });

  it('keeps other queued prompts when a different user message arrives', () => {
    const existing = [message(-1, 'first', 'sending'), message(-2, 'second', 'queued')];
    expect(reconcileOptimisticMessages(existing, [message(10, 'first')])).toEqual([
      message(10, 'first'),
      existing[1],
    ]);
  });

  it('does not erase a failed send when a later identical prompt succeeds', () => {
    const failed = {
      ...message(-1, 'retry'),
      data: { role: 'user' as const, content: 'retry', deliveryStatus: 'failed' as const },
    } as SessionEventRow;
    const sending = message(-2, 'retry', 'sending');
    const persisted = message(10, 'retry');
    expect(reconcileOptimisticMessages([failed, sending], [persisted])).toEqual([
      failed,
      persisted,
    ]);
  });

  it('does not consume the next queued prompt when a persisted event is replayed', () => {
    const persisted = message(10, 'repeat');
    const queued = message(-2, 'repeat', 'queued');
    expect(reconcileOptimisticMessages([persisted, queued], [persisted])).toEqual([
      persisted,
      queued,
    ]);
  });

  it('matches one identical prompt at a time', () => {
    const existing = [message(-1, 'repeat', 'sending'), message(-2, 'repeat', 'queued')];
    expect(reconcileOptimisticMessages(existing, [message(10, 'repeat')])).toEqual([
      message(10, 'repeat'),
      existing[1],
    ]);
  });
});
