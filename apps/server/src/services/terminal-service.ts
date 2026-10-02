import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';
import type { Logger } from '@agentctl/core';
import { noopLogger } from '@agentctl/core';

export interface TerminalSession {
  id: string;
  sessionId: string;
  cwd: string;
  cols: number;
  rows: number;
  process: ChildProcess;
  controlStream: Writable | null;
  historyBuffer: string[];
  maxHistoryBytes: number;
  currentHistoryBytes: number;
  createdAt: number;
  lastActiveAt: number;
}

// Python POSIX PTY bridge script that separates standard user I/O (fd 0) from PTY control (fd 3)
// This guarantees zero control sequence leakage into the shell's stdin.
const PYTHON_PTY_SCRIPT = `
import pty, os, sys, struct, fcntl, termios, select, signal, json

def main():
    cwd = sys.argv[1] if len(sys.argv) > 1 else '.'
    command_args = sys.argv[2:]
    try:
        os.chdir(cwd)
    except Exception:
        pass

    cols = int(os.environ.get('COLUMNS', 80))
    rows = int(os.environ.get('LINES', 24))

    master, slave = pty.openpty()
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except Exception:
        pass

    shell = os.environ.get('SHELL', '/bin/bash')
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.setsid()
        try:
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        except Exception:
            pass
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        try:
            os.close(3)
        except Exception:
            pass
        if slave > 2:
            os.close(slave)
        if command_args:
            os.execvpe(command_args[0], command_args, os.environ)
        os.execlp(shell, shell, '-i')
    else:
        os.close(slave)
        exit_status = None

        def forward_signal(sig, frame):
            try:
                os.kill(pid, sig)
            except Exception:
                pass
            sys.exit(0)

        signal.signal(signal.SIGTERM, forward_signal)
        signal.signal(signal.SIGHUP, forward_signal)

        while True:
            try:
                r, _, _ = select.select([0, master, 3], [], [], 0.5)
            except (KeyboardInterrupt, select.error, Exception):
                break

            # Check if child process has exited
            try:
                wpid, status = os.waitpid(pid, os.WNOHANG)
                if wpid != 0:
                    exit_status = status
                    # A short-lived child can exit before we forward its final
                    # output. Drain every buffered chunk before closing the PTY.
                    while True:
                        ready, _, _ = select.select([master], [], [], 0)
                        if master not in ready:
                            break
                        try:
                            data = os.read(master, 4096)
                            if not data:
                                break
                            os.write(1, data)
                        except OSError:
                            break
                    break
            except Exception:
                pass

            # fd 0: User Keystrokes (stdin -> master PTY)
            if 0 in r:
                try:
                    data = os.read(0, 4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    os.write(master, data)
                except OSError:
                    break

            # fd 3: Dedicated Control IPC (resizing, signals)
            if 3 in r:
                try:
                    data = os.read(3, 4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    for line in data.decode('utf-8', errors='ignore').split('\\n'):
                        line = line.strip()
                        if not line:
                            continue
                        msg = json.loads(line)
                        if 'cols' in msg and 'rows' in msg:
                            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', int(msg['rows']), int(msg['cols']), 0, 0))
                except Exception:
                    pass

            # master: Shell output (master PTY -> stdout)
            if master in r:
                try:
                    data = os.read(master, 4096)
                except OSError:
                    break
                if not data:
                    break
                try:
                    os.write(1, data)
                except OSError:
                    break

        try:
            os.close(master)
        except Exception:
            pass

        if exit_status is None:
            try:
                os.kill(pid, signal.SIGTERM)
                _, exit_status = os.waitpid(pid, 0)
            except Exception:
                exit_status = 1 << 8

        try:
            sys.exit(os.waitstatus_to_exitcode(exit_status))
        except Exception:
            sys.exit(1)

if __name__ == '__main__':
    main()
`;

export class InteractiveTerminalService extends EventEmitter {
  private activeTerminals = new Map<string, TerminalSession>(); // key: sessionId

  constructor(private logger: Logger = noopLogger) {
    super();
  }

  supportsCommandTerminal(): boolean {
    return os.platform() !== 'win32';
  }

  getOrCreateTerminal(sessionId: string, cwd: string, cols = 80, rows = 24): TerminalSession {
    const existing = this.activeTerminals.get(sessionId);
    if (existing && !existing.process.killed && existing.process.exitCode === null) {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    return this.spawnTerminal(sessionId, cwd, cols, rows);
  }

  spawnTerminal(sessionId: string, cwd: string, cols = 80, rows = 24): TerminalSession {
    this.killTerminal(sessionId);

    const isWindows = os.platform() === 'win32';
    const defaultShell = process.env.SHELL || (isWindows ? 'powershell.exe' : '/bin/bash');

    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SHELL: defaultShell,
      COLUMNS: cols.toString(),
      LINES: rows.toString(),
      PROMPT_EOL_MARK: '',
      AGENTCTL_SESSION_ID: sessionId,
      AGENTCTL_WORKTREE: cwd,
    };

    let child: ChildProcess;
    let controlStream: Writable | null = null;

    if (!isWindows) {
      try {
        child = spawn('python3', ['-u', '-c', PYTHON_PTY_SCRIPT, cwd], {
          cwd,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'], // fd 3 is dedicated control pipe
          shell: false,
        });
        controlStream = (child.stdio[3] as Writable) || null;
      } catch {
        child = spawn(defaultShell, ['-i'], {
          cwd,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        });
      }
    } else {
      child = spawn(defaultShell, [], {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    }

    const terminalSession: TerminalSession = {
      id: `term_${sessionId}`,
      sessionId,
      cwd,
      cols,
      rows,
      process: child,
      controlStream,
      historyBuffer: [],
      maxHistoryBytes: 512 * 1024, // 512KB scrollback buffer
      currentHistoryBytes: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    const appendHistory = (chunk: string) => {
      terminalSession.historyBuffer.push(chunk);
      terminalSession.currentHistoryBytes += chunk.length;
      while (
        terminalSession.currentHistoryBytes > terminalSession.maxHistoryBytes &&
        terminalSession.historyBuffer.length > 1
      ) {
        const removed = terminalSession.historyBuffer.shift();
        if (removed) terminalSession.currentHistoryBytes -= removed.length;
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      appendHistory(text);
      this.emit(`data:${sessionId}`, text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      appendHistory(text);
      this.emit(`data:${sessionId}`, text);
    });

    const onStreamError = (err: Error) => {
      this.logger.debug({ sessionId, err }, 'Interactive terminal stream closed with an error');
    };
    child.stdin?.on('error', onStreamError);
    child.stdout?.on('error', onStreamError);
    child.stderr?.on('error', onStreamError);
    controlStream?.on('error', onStreamError);

    child.on('close', (code, signal) => {
      this.logger.info({ sessionId, code, signal }, 'Interactive terminal process exited');
      this.emit(`exit:${sessionId}`, { code, signal });
      if (this.activeTerminals.get(sessionId) === terminalSession) {
        this.activeTerminals.delete(sessionId);
      }
    });

    child.on('error', (err) => {
      this.logger.error({ sessionId, err }, 'Interactive terminal process error');
      this.emit(`error:${sessionId}`, err);
    });

    this.activeTerminals.set(sessionId, terminalSession);
    return terminalSession;
  }

  spawnCommandTerminal(
    sessionId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    cols = 80,
    rows = 24,
  ): TerminalSession {
    this.killTerminal(sessionId);

    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLUMNS: cols.toString(),
      LINES: rows.toString(),
      PROMPT_EOL_MARK: '',
      ...env,
    };

    if (!this.supportsCommandTerminal()) {
      throw new Error('Interactive provider authentication is not supported on Windows yet');
    }

    const child = spawn('python3', ['-u', '-c', PYTHON_PTY_SCRIPT, cwd, command, ...args], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      shell: false,
    });
    const controlStream = (child.stdio[3] as Writable) || null;

    const terminalSession: TerminalSession = {
      id: `term_${sessionId}`,
      sessionId,
      cwd,
      cols,
      rows,
      process: child,
      controlStream,
      historyBuffer: [],
      maxHistoryBytes: 512 * 1024,
      currentHistoryBytes: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    const appendHistory = (chunk: string) => {
      terminalSession.historyBuffer.push(chunk);
      terminalSession.currentHistoryBytes += chunk.length;
      while (
        terminalSession.currentHistoryBytes > terminalSession.maxHistoryBytes &&
        terminalSession.historyBuffer.length > 1
      ) {
        const removed = terminalSession.historyBuffer.shift();
        if (removed) terminalSession.currentHistoryBytes -= removed.length;
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      appendHistory(text);
      this.emit(`data:${sessionId}`, text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      appendHistory(text);
      this.emit(`data:${sessionId}`, text);
    });

    child.on('close', (code, signal) => {
      this.logger.info({ sessionId, code, signal }, 'Interactive command terminal exited');
      this.emit(`exit:${sessionId}`, { code, signal });
      if (this.activeTerminals.get(sessionId) === terminalSession) {
        this.activeTerminals.delete(sessionId);
      }
    });

    child.on('error', (err) => {
      this.logger.error({ sessionId, err }, 'Interactive command terminal error');
      this.emit(`error:${sessionId}`, err);
    });

    const onStreamError = (err: Error) => {
      this.logger.debug({ sessionId, err }, 'Interactive command terminal stream closed');
    };
    child.stdin?.on('error', onStreamError);
    child.stdout?.on('error', onStreamError);
    child.stderr?.on('error', onStreamError);
    controlStream?.on('error', onStreamError);

    this.activeTerminals.set(sessionId, terminalSession);
    return terminalSession;
  }

  writeInput(sessionId: string, input: string): boolean {
    const term = this.activeTerminals.get(sessionId);
    if (!term || term.process.killed || term.process.stdin?.writable !== true) {
      return false;
    }
    term.lastActiveAt = Date.now();
    term.process.stdin.write(input);
    return true;
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): boolean {
    const term = this.activeTerminals.get(sessionId);
    if (!term || term.process.killed) {
      return false;
    }
    term.cols = cols;
    term.rows = rows;
    term.lastActiveAt = Date.now();

    // Send resize payload over isolated control channel (fd 3)
    if (term.controlStream && term.controlStream.writable) {
      term.controlStream.write(`${JSON.stringify({ cols, rows })}\n`);
      return true;
    }

    return false;
  }

  getHistory(sessionId: string): string {
    const term = this.activeTerminals.get(sessionId);
    return term ? term.historyBuffer.join('') : '';
  }

  killTerminal(sessionId: string): boolean {
    const term = this.activeTerminals.get(sessionId);
    if (!term) return false;

    try {
      if (!term.process.killed) {
        term.process.kill('SIGTERM');
      }
    } catch (err) {
      this.logger.warn({ sessionId, err }, 'Error killing interactive terminal');
    }
    this.activeTerminals.delete(sessionId);
    return true;
  }

  closeAll(): void {
    for (const sessionId of this.activeTerminals.keys()) {
      this.killTerminal(sessionId);
    }
  }
}
