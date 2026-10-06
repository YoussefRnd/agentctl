import { StringDecoder } from 'node:string_decoder';
import {
  ACP_PROCESS_OPTIONS,
  ownAcpProcess,
  terminateChildProcess,
  withTimeout,
} from '../transport/acp-process-lifecycle.js';
import { ACP_SESSION_CLOSE_TIMEOUT_MS } from '../transport/limits.js';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Logger } from '../../logger.js';
import { noopLogger } from '../../logger.js';

export interface TerminalOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  outputByteLimit?: number;
}

export interface TerminalErrorEvent {
  terminalId: string;
  error: Error;
}

export interface TerminalProcess {
  terminalId: string;
  child: ChildProcess;
  closed: Promise<{ exitCode: number | null; signal: string | null }>;
  output: string;
  exitCode: number | null;
  signal: string | null;
  hasExited: boolean;
  truncated: boolean;
}

export const MAX_TERMINAL_OUTPUT_BYTES = 1024 * 1024;
export const MAX_RETAINED_TERMINALS = 32;
export const MAX_ACTIVE_TERMINALS = 16;

export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, TerminalProcess>();

  constructor(private logger: Logger = noopLogger) {
    super();
  }

  spawn(options: TerminalOptions): TerminalId {
    if (
      this.terminals.size >= MAX_RETAINED_TERMINALS ||
      [...this.terminals.values()].filter((terminal) => !terminal.hasExited).length >=
        MAX_ACTIVE_TERMINALS
    )
      throw new Error('Terminal limit reached. Release unused terminals before creating more.');
    const terminalId = crypto.randomUUID();
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) cleanEnv[key] = value;
    }
    if (options.env) Object.assign(cleanEnv, options.env);
    const child = ownAcpProcess(
      spawn(options.command, options.args ?? [], {
        ...ACP_PROCESS_OPTIONS,
        cwd: options.cwd,
        env: cleanEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );

    const closed = Promise.withResolvers<{
      exitCode: number | null;
      signal: string | null;
    }>();

    const termRecord: TerminalProcess = {
      terminalId,
      child,
      output: '',
      exitCode: null,
      signal: null,
      hasExited: false,
      truncated: false,
      closed: closed.promise,
    };

    child.on('close', (code, signal) => {
      termRecord.exitCode = code;
      termRecord.signal = signal;
      termRecord.hasExited = true;
      this.emit('exit', { terminalId, code });
      closed.resolve({ exitCode: code, signal });
    });
    child.on('error', (error) => {
      this.logger.error({ terminalId, error }, 'Terminal process failed');
      this.emit('terminalError', { terminalId, error } satisfies TerminalErrorEvent);
      termRecord.hasExited = true;
      closed.resolve({ exitCode: null, signal: null });
    });

    const outputByteLimit =
      Number.isSafeInteger(options.outputByteLimit) && options.outputByteLimit! >= 0
        ? Math.min(options.outputByteLimit!, MAX_TERMINAL_OUTPUT_BYTES)
        : MAX_TERMINAL_OUTPUT_BYTES;

    let outputBytes = 0;
    const applyOutputLimit = () => {
      if (outputBytes <= outputByteLimit) return;
      const buf = Buffer.from(termRecord.output, 'utf8');
      if (buf.length > outputByteLimit) {
        let start = buf.length - outputByteLimit;
        while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start += 1;
        termRecord.output = buf.subarray(start).toString('utf8');
        outputBytes = buf.length - start;
        termRecord.truncated = true;
      }
    };

    const appendOutput = (text: string) => {
      if (!text) return;
      termRecord.output += text;
      outputBytes += Buffer.byteLength(text, 'utf8');
      applyOutputLimit();
      this.emit('output', { terminalId, data: text });
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8');
      stream.on('data', (data: Buffer) => appendOutput(decoder.write(data)));
      stream.on('end', () => appendOutput(decoder.end()));
    }

    this.terminals.set(terminalId, termRecord);

    return terminalId;
  }

  kill(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (term && !term.hasExited) {
      terminateChildProcess(term.child, this.logger);
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
      this.logger.debug(
        { terminalId, bytes: Buffer.byteLength(data, 'utf8') },
        'Writing terminal input',
      );
      return term.child.stdin.write(data);
    }
    this.logger.warn(`terminal ${terminalId} not found for write`);
    return false;
  }

  release(terminalId: string): void {
    const term = this.terminals.get(terminalId);
    if (term) {
      if (!term.hasExited) {
        terminateChildProcess(term.child, this.logger, 0, 'SIGKILL');
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
        terminateChildProcess(term.child, this.logger);
      }
    }

    if (promises.length > 0) {
      await withTimeout(
        Promise.all(promises),
        ACP_SESSION_CLOSE_TIMEOUT_MS,
        'waiting for terminals to exit',
      ).catch(() => undefined);

      for (const term of this.terminals.values()) {
        if (!term.hasExited) {
          terminateChildProcess(term.child, this.logger, 0, 'SIGKILL');
        }
      }
    }

    this.terminals.clear();
  }
}

export type TerminalId = string;
