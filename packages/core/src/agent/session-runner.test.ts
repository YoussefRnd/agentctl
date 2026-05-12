import { describe, it, expect, vi } from 'vitest';
import { SessionRunner, type DbClient } from './session-runner.js';
import type { ACPClient } from './acp-client.js';
import { EventEmitter } from 'node:events';

describe('SessionRunner', () => {
  it('should persist event to DB before publishing to EventBus', async () => {
    const mockClient = new EventEmitter() as unknown as ACPClient;
    const mockDb = { 
      insert: vi.fn().mockReturnThis(), 
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 1, createdAt: new Date() }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(true)
    };
    const mockEventBus = { publish: vi.fn() };
    
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _runner = new SessionRunner(
      'session-1', 
      mockClient, 
      mockDb as unknown as DbClient, 
      mockEventBus
    );
    
    const eventPromise = new Promise((resolve) => {
      mockEventBus.publish.mockImplementation((e: unknown) => { resolve(e); });
    });

    mockClient.emit('event', { type: 'text', data: 'hello', createdAt: new Date() });
    
    await eventPromise;

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockEventBus.publish).toHaveBeenCalled();
  });
});
