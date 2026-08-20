import { describe, it, expect, afterEach } from 'vitest';
import { InteractiveTerminalService } from './terminal-service.js';
import os from 'node:os';

describe('InteractiveTerminalService', () => {
  let service: InteractiveTerminalService;

  afterEach(() => {
    service?.closeAll();
  });

  it('spawns a shell process and receives output', async () => {
    service = new InteractiveTerminalService();
    const tempDir = os.tmpdir();
    const sessionId = 'test-session-1';

    const term = service.spawnTerminal(sessionId, tempDir);
    expect(term).toBeDefined();
    expect(term.process.pid).toBeDefined();

    // Listen for data output
    const outputReceived = await new Promise<boolean>((resolve) => {
      const onData = (data: string) => {
        if (data.length > 0) {
          service.off(`data:${sessionId}`, onData);
          resolve(true);
        }
      };
      service.on(`data:${sessionId}`, onData);

      // Trigger echo command
      setTimeout(() => {
        service.writeInput(sessionId, 'echo "interactive-terminal-alive"\n');
      }, 50);
    });

    expect(outputReceived).toBe(true);

    const history = service.getHistory(sessionId);
    expect(history.length).toBeGreaterThan(0);
  });

  it('kills and cleans up terminal process', () => {
    service = new InteractiveTerminalService();
    const sessionId = 'test-session-2';
    const term = service.spawnTerminal(sessionId, os.tmpdir());

    expect(term.process.killed).toBe(false);
    const killed = service.killTerminal(sessionId);
    expect(killed).toBe(true);
  });

  it('resizes terminal dimensions', () => {
    service = new InteractiveTerminalService();
    const sessionId = 'test-session-3';
    const term = service.spawnTerminal(sessionId, os.tmpdir(), 80, 24);

    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);

    const resized = service.resizeTerminal(sessionId, 120, 40);
    expect(resized).toBe(true);
    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);
  });
});
