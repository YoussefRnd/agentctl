import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { QueryClient } from '@tanstack/react-query';
import type { SessionEventRow } from '@agentctl/shared';
import { sessionKeys } from '@/shared/lib/queryKeys';

vi.mock('@agentctl/api-client', () => ({ api: { sendInput: vi.fn() } }));

import { api } from '@agentctl/api-client';
import { sendSessionInput, updateOptimisticDelivery } from './messageDelivery';

const sendInput = vi.mocked(api.sendInput);

beforeEach(() => sendInput.mockReset());

describe('message delivery', () => {
  it('uses a persisted event id as the acceptance acknowledgment', async () => {
    sendInput.mockResolvedValue({ status: 200, body: { success: true, eventId: 31 } } as never);
    await expect(sendSessionInput('session-1', 'hello')).resolves.toBe(31);
  });

  it('surfaces a rejected handoff reason', async () => {
    sendInput.mockResolvedValue({
      status: 409,
      body: { success: false, message: 'Session is unavailable' },
    } as never);
    await expect(sendSessionInput('session-1', 'hello')).rejects.toThrow('Session is unavailable');
  });

  it('keeps a failed optimistic message visible with its error', () => {
    const queryClient = new QueryClient();
    const event = {
      id: -1,
      sessionId: 'session-1',
      type: 'text',
      data: { role: 'user', content: 'hello', deliveryStatus: 'sending' },
      createdAt: new Date(),
    } as SessionEventRow;
    queryClient.setQueryData(sessionKeys.events('session-1'), [event]);
    updateOptimisticDelivery(queryClient, 'session-1', -1, 'failed', 'Session is unavailable');

    expect(queryClient.getQueryData<SessionEventRow[]>(sessionKeys.events('session-1'))).toEqual([
      expect.objectContaining({
        id: -1,
        data: expect.objectContaining({
          deliveryStatus: 'failed',
          deliveryError: 'Session is unavailable',
        }),
      }),
    ]);
  });
});
