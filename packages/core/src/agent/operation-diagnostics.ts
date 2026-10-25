import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';
import { redactAgentErrorText } from './error-redaction.js';

const traces = new WeakMap<object, ReturnType<OperationDiagnostics['finish']>>();

/** Local lifecycle timings. Never record launch arguments, environment values or wire frames. */
export class OperationDiagnostics {
  readonly id = randomUUID();
  readonly startedAt = new Date().toISOString();
  private readonly start = performance.now();
  private stages: { stage: string; startedMs: number; durationMs: number }[] = [];
  private completed?: { outcome: 'success' | 'error'; elapsedMs: number };

  constructor(
    private operation: string,
    private logger: Logger,
    private context: Record<string, string | number | undefined> = {},
  ) {}

  stage(stage: string): void {
    if (this.completed) return;
    const elapsedMs = Math.round(performance.now() - this.start);
    const previous = this.stages.at(-1);
    if (previous) previous.durationMs = elapsedMs - previous.startedMs;
    this.stages.push({ stage, startedMs: elapsedMs, durationMs: 0 });
    this.logger.info(
      { ...this.context, operation: this.operation, operationId: this.id, stage, elapsedMs },
      'Provider operation stage started',
    );
  }

  finish(outcome: 'success' | 'error') {
    if (!this.completed) {
      const elapsedMs = Math.round(performance.now() - this.start);
      const previous = this.stages.at(-1);
      if (previous) previous.durationMs = elapsedMs - previous.startedMs;
      this.completed = { outcome, elapsedMs };
      this.logger.info(
        {
          ...this.context,
          operation: this.operation,
          operationId: this.id,
          ...this.completed,
          stages: this.stages,
        },
        'Provider operation finished',
      );
    }
    return {
      operationId: this.id,
      operation: this.operation,
      startedAt: this.startedAt,
      ...this.completed,
      failedStage: this.completed.outcome === 'error' ? this.stages.at(-1)?.stage : undefined,
      stages: this.stages.map((stage) => ({ ...stage })),
    };
  }

  fail(error: unknown): void {
    const snapshot = this.finish('error');
    if (error && typeof error === 'object') traces.set(error, snapshot);
  }
}

export function redactDiagnosticText(
  text: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  return redactAgentErrorText(text, environment).replace(
    /((?:[\w.-]*(?:token|password|secret|credential|authorization|api[_-]?key)|_auth)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    '$1[redacted]',
  );
}

/** Keep transport causes (including AggregateError) and exit details without dumping objects. */
export function diagnosticError(
  error: unknown,
  environment: Record<string, string | undefined> = process.env,
  seen = new Set<object>(),
  depth = 0,
  budget = { nodes: 20, characters: 64 * 1024 },
): Record<string, unknown> {
  if (budget.nodes-- <= 0) return { message: '[additional errors omitted]' };
  const clean = (value: string) => {
    const result = redactDiagnosticText(value, environment).slice(
      0,
      Math.min(16_384, budget.characters),
    );
    budget.characters -= result.length;
    return result;
  };
  if (!error || typeof error !== 'object') return { message: clean(String(error)) };
  if (seen.has(error) || depth >= 6) return { message: '[nested error omitted]' };
  seen.add(error);
  const source = error as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of [
    'name',
    'message',
    'stack',
    'code',
    'errno',
    'syscall',
    'hostname',
    'address',
    'port',
    'status',
    'statusCode',
    'signal',
    'killed',
    'exitCode',
    'processExitCode',
    'processSignal',
    'processPid',
    'executable',
    'stdout',
    'stderr',
    'processDiagnostics',
    'details',
    'downloadUrl',
    'downloadedBytes',
    'totalBytes',
  ]) {
    const value = source[key];
    if (typeof value === 'string') result[key] = clean(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      result[key] = value;
  }
  if (source.cause)
    result.cause = diagnosticError(source.cause, environment, seen, depth + 1, budget);
  if (source.data) result.data = diagnosticError(source.data, environment, seen, depth + 1, budget);
  if (source.error)
    result.error = diagnosticError(source.error, environment, seen, depth + 1, budget);
  if (Array.isArray(source.errors))
    result.errors = source.errors
      .slice(0, 5)
      .map((e) => diagnosticError(e, environment, seen, depth + 1, budget));
  const trace = traces.get(error);
  if (trace) result.operationDiagnostics = trace;
  return result;
}
