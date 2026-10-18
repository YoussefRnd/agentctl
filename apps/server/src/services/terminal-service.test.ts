import os from 'node:os';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { InteractiveTerminalService } from './terminal-service.js';

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

    const outputReceived = await new Promise<boolean>((resolve) => {
      const onData = (data: string) => {
        if (data.length > 0) {
          service.off(`data:${sessionId}`, onData);
          resolve(true);
        }
      };
      service.on(`data:${sessionId}`, onData);

      setTimeout(() => {
        service.writeInput(sessionId, 'echo "interactive-terminal-alive"\n');
      }, 50);
    });

    expect(outputReceived).toBe(true);
    expect(service.getHistory(sessionId).length).toBeGreaterThan(0);
  });

  it('kills and cleans up terminal process', () => {
    service = new InteractiveTerminalService();
    const sessionId = 'test-session-2';
    const term = service.spawnTerminal(sessionId, os.tmpdir());

    expect(term.process.killed).toBe(false);
    expect(service.killTerminal(sessionId)).toBe(true);
  });

  it('resizes terminal dimensions', () => {
    service = new InteractiveTerminalService();
    const sessionId = 'test-session-3';
    const term = service.spawnTerminal(sessionId, os.tmpdir(), 80, 24);

    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);

    expect(service.resizeTerminal(sessionId, 120, 40)).toBe(true);
    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);
  });

  it.skipIf(process.platform === 'win32')('runs provider commands inside a real PTY', async () => {
    service = new InteractiveTerminalService();
    const terminal = service.spawnCommandTerminal(
      'provider-auth-test',
      '/bin/sh',
      ['-c', 'if [ -t 0 ] && [ -t 1 ]; then printf PTY_OK; else printf NO_PTY; fi'],
      {},
      os.tmpdir(),
    );

    let output = '';
    service.on('data:provider-auth-test', (data: string) => {
      output += data;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      // close waits for stdout to drain; exit can arrive before the final data event.
      terminal.process.once('close', resolve);
      terminal.process.once('error', reject);
    });

    expect(exitCode).toBe(0);
    expect(output).toContain('PTY_OK');
    expect(output).not.toContain('NO_PTY');
  });

  it.skipIf(process.platform === 'win32')(
    'drains buffered PTY output before emitting command exit',
    async () => {
      service = new InteractiveTerminalService();
      const sessionId = 'buffered-output';
      let output = '';
      service.on(`data:${sessionId}`, (data: string) => {
        output += data;
      });
      const completed = new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        service.once(`exit:${sessionId}`, ({ code }: { code: number | null }) =>
          resolve({ code, output }),
        );
        service.once(`error:${sessionId}`, reject);
      });
      service.spawnCommandTerminal(
        sessionId,
        'python3',
        [
          '-c',
          "import sys; sys.stdout.write('x' * 65536 + 'END'); sys.stdout.flush(); sys.exit(23)",
        ],
        {},
        os.tmpdir(),
      );
      const result = await completed;
      expect(result.code).toBe(23);
      expect(result.output).toBe('x'.repeat(65536) + 'END');
    },
  );
});
