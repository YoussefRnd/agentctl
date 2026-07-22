import path from 'node:path';
import type { TerminalManager } from './terminal-manager.js';
import type { Logger } from '../../logger.js';
import type { DomainAgentEvent } from '../types.js';

export interface CreateTerminalParams {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  outputByteLimit?: number;
}

export interface BuiltinBashParams {
  command: string;
  args?: string[];
  pty?: boolean;
  input?: string;
  cwd?: string;
}

export async function handleTerminalCreate(
  p: CreateTerminalParams,
  terminalManager: TerminalManager,
  sessionCwd: string,
  logger: Logger,
  onEvent: (e: DomainAgentEvent) => void | Promise<void>,
): Promise<{ terminalId: string }> {
  const terminalCwd = p.cwd
    ? path.isAbsolute(p.cwd)
      ? p.cwd
      : path.resolve(sessionCwd, p.cwd)
    : sessionCwd;
  logger.debug(`Terminal create requested for ${p.command} in ${terminalCwd}`);
  const terminalId = terminalManager.spawn({
    command: p.command,
    args: p.args,
    cwd: terminalCwd,
    env: p.env,
    outputByteLimit: p.outputByteLimit,
  });
  await onEvent({ type: 'terminal_created', terminalId, command: p.command });
  return { terminalId };
}

export function handleTerminalRelease(
  p: { terminalId: string },
  terminalManager: TerminalManager,
  logger: Logger,
): Record<string, never> {
  logger.debug(`Terminal release requested for ${p.terminalId}`);
  terminalManager.release(p.terminalId);
  return {};
}

export function handleTerminalOutput(
  p: { terminalId: string },
  terminalManager: TerminalManager,
  logger: Logger,
): {
  output: string;
  truncated: boolean;
  exitStatus?: { exitCode: number | null; signal: NodeJS.Signals | null };
} {
  logger.debug(`Terminal output requested for ${p.terminalId}`);
  const term = terminalManager.getTerminal(p.terminalId);
  if (!term) {
    throw new Error(`Terminal not found: ${p.terminalId}`);
  }
  const exitStatus = term.hasExited
    ? { exitCode: term.exitCode, signal: term.signal as NodeJS.Signals | null }
    : undefined;
  return {
    output: term.output,
    truncated: term.truncated,
    ...(exitStatus ? { exitStatus } : {}),
  };
}

export async function handleTerminalWaitForExit(
  p: { terminalId: string },
  terminalManager: TerminalManager,
  logger: Logger,
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  logger.debug(`Terminal wait_for_exit requested for ${p.terminalId}`);
  const term = terminalManager.getTerminal(p.terminalId);
  if (!term) {
    throw new Error(`Terminal not found: ${p.terminalId}`);
  }
  const res = await term.closed;
  return {
    exitCode: res.exitCode,
    signal: res.signal as NodeJS.Signals | null,
  };
}

export function handleTerminalKill(
  p: { terminalId: string },
  terminalManager: TerminalManager,
  logger: Logger,
): Record<string, never> {
  logger.debug(`Terminal kill requested for ${p.terminalId}`);
  terminalManager.kill(p.terminalId);
  return {};
}

export function handleTerminalWrite(
  p: { terminalId: string; data: string },
  terminalManager: TerminalManager,
  logger: Logger,
): Record<string, never> {
  logger.debug(`Terminal write requested for ${p.terminalId}`);
  const ok = terminalManager.write(p.terminalId, p.data);
  if (!ok) {
    throw new Error(`Failed to write to terminal ${p.terminalId}`);
  }
  return {};
}

export async function handleBuiltinBash(
  p: BuiltinBashParams,
  terminalManager: TerminalManager,
  sessionCwd: string,
  logger: Logger,
): Promise<{ terminalId?: string; output: string; exitCode: number | null }> {
  const resolvedCwd = p.cwd
    ? path.isAbsolute(p.cwd)
      ? p.cwd
      : path.resolve(sessionCwd, p.cwd)
    : sessionCwd;
  logger.debug(`builtin/bash: ${p.command} in ${resolvedCwd} (pty: ${String(p.pty)})`);
  const terminalId = terminalManager.spawn({
    command: p.command,
    args: p.args,
    cwd: resolvedCwd,
  });
  if (p.input) {
    terminalManager.write(terminalId, p.input);
  }
  if (!p.pty) {
    const result = await terminalManager.wait(terminalId);
    const term = terminalManager.getTerminal(terminalId);
    return {
      output: term?.output ?? '',
      exitCode: result?.exitCode ?? null,
    };
  }
  return {
    terminalId,
    output: '',
    exitCode: null,
  };
}
