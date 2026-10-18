import { trace } from '@opentelemetry/api';
import * as metrics from '@opentelemetry/sdk-metrics';
import * as logs from '@opentelemetry/sdk-logs';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createSdk } from './sdk.js';

const config = {
  enabled: true as const,
  tracesUrl: 'http://127.0.0.1:1/v1/traces',
  metricsUrl: 'http://127.0.0.1:1/v1/metrics',
  logsUrl: 'http://127.0.0.1:1/v1/logs',
  sampleRatio: 1,
};
afterEach(() => vi.restoreAllMocks());

test('partial initialization closes the tracer when metric construction fails', async () => {
  const provider = trace.getTracerProvider();
  const closed = vi.spyOn(TracerProvider.prototype, 'shutdown');
  vi.spyOn(metrics, 'MeterProvider').mockImplementation(function () {
    throw new Error('metric setup failed');
  });
  await expect(createSdk(config, 'agentctl-server')).rejects.toThrow('metric setup failed');
  expect(closed).toHaveBeenCalledOnce();
  expect(trace.getTracerProvider()).toBe(provider);
});

test('partial initialization closes all earlier providers when log construction fails', async () => {
  const tracesClosed = vi.spyOn(TracerProvider.prototype, 'shutdown');
  const metricsClosed = vi.spyOn(metrics.MeterProvider.prototype, 'shutdown');
  vi.spyOn(logs, 'LoggerProvider').mockImplementation(function () {
    throw new Error('log setup failed');
  });
  await expect(createSdk(config, 'agentctl-server')).rejects.toThrow('log setup failed');
  expect(tracesClosed).toHaveBeenCalledOnce();
  expect(metricsClosed).toHaveBeenCalledOnce();
});

test('shutdown still closes other providers when one throws synchronously', async () => {
  const sdk = await createSdk(config, 'agentctl-server');
  const closeTracer = sdk.tracer.shutdown.bind(sdk.tracer);
  const closeMetrics = vi.spyOn(sdk.meter, 'shutdown');
  const closeLogs = vi.spyOn(sdk.logger, 'shutdown');
  vi.spyOn(sdk.tracer, 'shutdown').mockImplementation(() => {
    throw new Error('shutdown failed');
  });
  try {
    await expect(sdk.shutdown()).resolves.toBeUndefined();
    expect(closeMetrics).toHaveBeenCalledOnce();
    expect(closeLogs).toHaveBeenCalledOnce();
  } finally {
    await closeTracer();
  }
});

test('shutdown stays bounded even if a provider never resolves', async () => {
  const sdk = await createSdk(config, 'agentctl-server');
  const closeTracer = sdk.tracer.shutdown.bind(sdk.tracer);
  vi.spyOn(sdk.tracer, 'shutdown').mockImplementation(() => new Promise(() => undefined));
  vi.useFakeTimers();
  try {
    const closing = sdk.shutdown();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(closing).resolves.toBeUndefined();
  } finally {
    vi.useRealTimers();
    await closeTracer();
  }
});
