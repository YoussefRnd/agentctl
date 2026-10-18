import { context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

// Exact fixed messages only. Object fields, errors, bindings and format arguments stay local.
const messages = new Map([
  ['incoming request', 'http.request.received'],
  ['request completed', 'http.request.completed'],
  ['request errored', 'http.request.failed'],
  ['Session operation worker failed', 'queue.worker.failed'],
  ['Failed to wake the accepted queue', 'queue.wake.failed'],
  ['Accepted session message failed', 'queue.message.failed'],
  ['Closing idle persistent connection', 'provider.connection.idle'],
  ['Invalid ACP subagent update', 'provider.update.invalid'],
  ['Failed to close session on agent', 'provider.session.close.failed'],
  ['Terminal process failed', 'terminal.process.failed'],
]);

const severities = new Map([
  [10, ['TRACE', SeverityNumber.TRACE] as const],
  [20, ['DEBUG', SeverityNumber.DEBUG] as const],
  [30, ['INFO', SeverityNumber.INFO] as const],
  [40, ['WARN', SeverityNumber.WARN] as const],
  [50, ['ERROR', SeverityNumber.ERROR] as const],
  [60, ['FATAL', SeverityNumber.FATAL] as const],
]);

/** Bridge application log calls without ever serializing their arbitrary message/object data. */
export function emitApplicationLog(level: number, args: readonly unknown[]): void {
  const severity = severities.get(level) ?? ['INFO', SeverityNumber.INFO];
  const logger = logs.getLogger('agentctl.application');
  if (!logger.enabled({ severityNumber: severity[1] })) return;
  const message =
    typeof args[0] === 'string' ? args[0] : typeof args[1] === 'string' ? args[1] : '';
  const eventName = messages.get(message);
  logger.emit({
    eventName: eventName ?? 'app.log',
    body: eventName ? message : 'Application log; details retained locally',
    severityText: severity[0],
    severityNumber: severity[1],
    context: context.active(),
  });
}
