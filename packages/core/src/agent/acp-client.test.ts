import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { ACPClient } from './acp-client.js';
import type { ACPEvent } from '@agentctl/shared';

describe('ACPClient', () => {
  it('should buffer and parse fragmented NDJSON chunks', () => {
    const mockProcess = Object.assign(new EventEmitter(), {
      stdout: new Readable({ read() { return null; } }),
      stderr: new Readable({ read() { return null; } }),
      stdin: new Writable({ write() { return true; } }),
    }) as unknown as ChildProcess;

    const client = new ACPClient(mockProcess);
    const events: ACPEvent[] = [];
    client.on('event', (e) => events.push(e));

    // Emit fragmented JSON
    mockProcess.stdout?.emit('data', Buffer.from('{"type":"te'));
    mockProcess.stdout?.emit('data', Buffer.from('xt","data":"hello"}\n'));
    mockProcess.stdout?.emit('data', Buffer.from('{"type":"s'));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text', data: 'hello' });
  });
});
