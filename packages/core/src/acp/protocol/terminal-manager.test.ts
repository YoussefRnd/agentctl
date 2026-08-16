import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TerminalManager } from './terminal-manager.js';

describe('TerminalManager', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    manager = new TerminalManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it('should spawn a process and emit output', async () => {
    return new Promise<void>((resolve, reject) => {
      const terminalId = manager.spawn({
        command: 'echo',
        args: ['hello terminal'],
      });

      expect(terminalId).toBeDefined();

      let output = '';
      manager.on('output', (event) => {
        const { terminalId: id, data } = event as { terminalId: string; data: string };
        if (id === terminalId) {
          output += data;
        }
      });

      manager.on('exit', (event) => {
        const { terminalId: id, code } = event as { terminalId: string; code: number };
        if (id === terminalId) {
          try {
            expect(output.trim()).toBe('hello terminal');
            expect(code).toBe(0);
            resolve();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }
      });
    });
  });

  it('should kill a process', async () => {
    const terminalId = manager.spawn({
      command: 'sleep',
      args: ['10'],
    });

    const waitPromise = manager.wait(terminalId);
    manager.kill(terminalId);

    const code = await waitPromise;
    expect(code).not.toBe(0); // Should be null or signal-related code
  });

  it('reports spawn failures without emitting the special error event', async () => {
    const terminalError = new Promise<{ terminalId: string; error: Error }>((resolve) => {
      manager.once('terminalError', (event: { terminalId: string; error: Error }) =>
        resolve(event),
      );
    });

    const terminalId = manager.spawn({ command: `missing-agentctl-command-${Date.now()}` });
    const [event, result] = await Promise.all([terminalError, manager.wait(terminalId)]);

    expect(event.terminalId).toBe(terminalId);
    expect(event.error).toBeInstanceOf(Error);
    expect(result).toEqual({ exitCode: null, signal: null });
  });

  it('truncates output on a valid UTF-8 character boundary', async () => {
    const terminalId = manager.spawn({
      command: 'node',
      args: ['-e', 'process.stdout.write("🙂🙂")'],
      outputByteLimit: 5,
    });

    await manager.wait(terminalId);
    const terminal = manager.getTerminal(terminalId);
    expect(terminal?.output).toBe('🙂');
    expect(terminal?.output).not.toContain('�');
  });

  it('should support writing data to standard input', async () => {
    return new Promise<void>((resolve, reject) => {
      const terminalId = manager.spawn({
        command: 'node',
        args: [
          '-e',
          'process.stdin.on("data", (data) => { console.log("received:" + data.toString().trim()); process.exit(0); });',
        ],
      });

      expect(terminalId).toBeDefined();

      let output = '';
      manager.on('output', (event) => {
        const { terminalId: id, data } = event as { terminalId: string; data: string };
        if (id === terminalId) {
          output += data;
        }
      });

      manager.on('exit', (event) => {
        const { terminalId: id, code } = event as { terminalId: string; code: number };
        if (id === terminalId) {
          try {
            expect(output.trim()).toContain('received:hello stdinput');
            expect(code).toBe(0);
            resolve();
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }
      });

      setTimeout(() => {
        const success = manager.write(terminalId, 'hello stdinput\n');
        expect(success).toBe(true);
      }, 150);
    });
  });
});
