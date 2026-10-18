import { context, metrics, trace } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { telemetryConfig } from './config.js';
import type { TelemetrySdk } from './sdk.js';

export interface TelemetryRuntime {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}
export type TelemetryRole = 'server' | 'desktop-server' | 'desktop';
const disabled: TelemetryRuntime = { enabled: false, shutdown: () => Promise.resolve() };
let starting: Promise<TelemetryRuntime> | undefined;

/** One explicit, optional SDK owner per process. Imports alone never start an exporter. */
export function startTelemetry(role: TelemetryRole): Promise<TelemetryRuntime> {
  if (starting) return starting;
  const pending = start(role);
  starting = pending;
  void pending.then((runtime) => {
    if (!runtime.enabled && starting === pending) starting = undefined;
  });
  return pending;
}

async function start(role: TelemetryRole): Promise<TelemetryRuntime> {
  let config;
  try {
    config = telemetryConfig(process.env);
  } catch {
    process.stderr.write('AgentCtl telemetry disabled: invalid configuration.\n');
    return disabled;
  }
  if (!config.enabled) return disabled;

  let sdk: TelemetrySdk | undefined;
  const owns = { trace: false, metrics: false, context: false, logs: false };
  let shuttingDown: Promise<void> | undefined;
  const shutdown = () =>
    (shuttingDown ??= (async () => {
      try {
        if (owns.logs)
          sdk?.logger.getLogger('agentctl.lifecycle').emit({
            body: 'telemetry.stopping',
            severityNumber: SeverityNumber.INFO,
          });
        await sdk?.shutdown();
      } finally {
        if (owns.trace) trace.disable();
        if (owns.metrics) metrics.disable();
        if (owns.context) context.disable();
        if (owns.logs) logs.disable();
        sdk?.manager.disable();
        starting = undefined;
      }
    })());

  try {
    const { createSdk } = await import('./sdk.js');
    sdk = await createSdk(config, `agentctl-${role}`);
    owns.trace = trace.setGlobalTracerProvider(sdk.tracer);
    owns.metrics = metrics.setGlobalMeterProvider(sdk.meter);
    owns.context = context.setGlobalContextManager(sdk.manager.enable());
    owns.logs = logs.setGlobalLoggerProvider(sdk.logger) === sdk.logger;
    if (!Object.values(owns).every(Boolean)) {
      await shutdown();
      process.stderr.write('AgentCtl telemetry disabled: another SDK already owns this process.\n');
      return disabled;
    }
    sdk.logger
      .getLogger('agentctl.lifecycle')
      .emit({ body: 'telemetry.started', severityNumber: SeverityNumber.INFO });
    return { enabled: true, shutdown };
  } catch {
    await shutdown();
    process.stderr.write('AgentCtl telemetry could not start; continuing without telemetry.\n');
    return disabled;
  }
}
