import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';

export interface TerminalOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalProcess {
  terminalId: string;
  child: ChildProcess;
  closed: Promise<{ exitCode: number | null; signal: string | null }>;
  output: string;
  exitCode: number | null;
  signal: string | null;
  hasExited: boolean;
}

export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, TerminalProcess>();

  constructor(private logger: Logger = noopLogger) {
    super();
  }

  spawn(options: TerminalOptions): TerminalId {
    const terminalId = crypto.randomUUID();
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) cleanEnv[key] = value;
    }
    if (options.env) Object.assign(cleanEnv, options.env);
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: cleanEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const termRecord: TerminalProcess = {
      terminalId,
      child,
      output: '',
      exitCode: null,
      signal: null,
      hasExited: false,
      closed: null as unknown as Promise<{ exitCode: number | null; signal: string | null }>,
    };

    termRecord.closed = new Promise<{ exitCode: number | null; signal: string | null }>(
      (resolve) => {
        child.on('exit', (code, signal) => {
          termRecord.exitCode = code;
          termRecord.signal = signal;
          termRecord.hasExited = true;
          this.emit('exit', { terminalId, code });
          resolve({ exitCode: code, signal });
        });
        child.on('error', (err) => {
          this.emit('error', { terminalId, error: err });
          termRecord.hasExited = true;
          resolve({ exitCode: null, signal: null });
        });
      },
    );

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      termRecord.output += text;
      this.emit('output', { terminalId, data: text });
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      termRecord.output += text;
      this.emit('output', { terminalId, data: text });
    });

    this.terminals.set(terminalId, termRecord);

    return terminalId;
  }

  kill(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (term && !term.hasExited) {
      term.child.kill();
    }
  }

  write(terminalId: string, data: string): boolean {
    const term = this.terminals.get(terminalId);
    if (term) {
      if (term.hasExited) {
        this.logger.warn(`cannot write, terminal ${terminalId} already exited`);
        return false;
      }
      if (!term.child.stdin) {
        this.logger.warn(`cannot write, terminal ${terminalId} stdin is null`);
        return false;
      }
      this.logger.info({ terminalId, data }, `writing data to terminal`);
      return term.child.stdin.write(data);
    }
    this.logger.warn(`terminal ${terminalId} not found for write`);
    return false;
  }

  release(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (term) {
      if (!term.hasExited) {
        term.child.kill('SIGKILL');
      }
      this.terminals.delete(terminalId);
    }
  }

  async wait(
    terminalId: string,
  ): Promise<{ exitCode: number | null; signal: string | null } | null> {
    const term = this.terminals.get(terminalId);
    if (!term) return null;
    return term.closed;
  }

  getTerminal(terminalId: string): TerminalProcess | undefined {
    return this.terminals.get(terminalId);
  }

  async dispose(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    for (const term of this.terminals.values()) {
      promises.push(term.closed);
      if (!term.hasExited) {
        term.child.kill('SIGTERM');
      }
    }

    if (promises.length > 0) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await Promise.race([Promise.all(promises), timeout]);

      for (const term of this.terminals.values()) {
        if (!term.hasExited) {
          term.child.kill('SIGKILL');
        }
      }
    }

    this.terminals.clear();
  }
}

export type TerminalId = string;
