import { createServer } from 'node:http';
import { once } from 'node:events';
import Fastify from 'fastify';
import { context, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  recordConnectionEvent,
  TurnObservation,
  captureTraceparent,
  observeQueueSend,
  observeQueueProcess,
  observeProviderPrompt,
  emitOperationalEvent,
} from '@agentctl/core/observability';
import { beforeEach, afterEach, expect, test, vi } from 'vite-plus/test';
import { startTelemetry } from './runtime.js';
import { instrumentHttp } from './http.js';
import { emitApplicationLog } from './logs.js';

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  for (const key of [
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
    'OTEL_EXPORTER_OTLP_PROTOCOL',
    'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
    'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
    'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
    'OTEL_SDK_DISABLED',
  ])
    vi.stubEnv(key, '');
  vi.stubEnv('AGENTCTL_TELEMETRY_SAMPLE_RATIO', '1');
});

test('disabled telemetry leaves the global API untouched even when an endpoint is configured', async () => {
  vi.stubEnv('AGENTCTL_TELEMETRY', '0');
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
  const provider = trace.getTracerProvider();
  const logProvider = logs.getLoggerProvider();
  const runtime = await startTelemetry('server');
  expect(runtime.enabled).toBe(false);
  expect(trace.getTracerProvider()).toBe(provider);
  expect(logs.getLoggerProvider()).toBe(logProvider);
  await runtime.shutdown();
});

test('real OTLP exports preserve async trace context and only allowlisted operational data', async () => {
  const received: Array<{ path: string; body: Buffer }> = [];
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Collector did not listen');
  vi.stubEnv('AGENTCTL_TELEMETRY', '1');
  vi.stubEnv('AGENTCTL_TELEMETRY_SAMPLE_RATIO', '1');
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', `http://127.0.0.1:${String(address.port)}`);
  // Default resource detection must never collect this environment content.
  vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'private.resource=resource-secret');
  const runtime = await startTelemetry('server');
  const app = Fastify({
    logger: {
      level: 'trace',
      stream: { write() {} },
      hooks: {
        logMethod(args, method, level) {
          emitApplicationLog(level, args);
          method.apply(this, args);
        },
      },
    },
  });
  let queuedTrace: string | undefined;
  try {
    expect(runtime.enabled).toBe(true);
    expect(await startTelemetry('server')).toBe(runtime);
    instrumentHttp(app);
    app.post('/turn/:id', async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const active = trace.getActiveSpan();
      active?.addEvent('handler.ready');
      const turn = new TurnObservation();
      const connection = {
        kind: 'connection_ready',
        adapter: 'acp-v2',
        providerId: 'provider-secret',
      } as const;
      recordConnectionEvent(connection);
      const eventAttributes = {
        'agentctl.turn.outcome': 'success' as const,
        privateField: 'extra-attribute-secret',
      };
      emitOperationalEvent('agent.turn.finished', eventAttributes);
      queuedTrace = observeQueueSend((traceparent) => traceparent);
      app.log.warn(
        { path: 'log-field-secret', err: new Error('log-error-secret') },
        'Accepted session message failed',
      );
      app.log.error('dynamic-log-secret %s', 'format-secret');
      turn.phase('dispatched');
      turn.phase('first_output');
      turn.finish('success', { preparationMs: 10, firstOutputMs: 20, completionMs: 30 });
      turn.finish('error', {});
      return { traceId: active?.spanContext().traceId };
    });
    app.get('/error/:id', async () => {
      throw new Error('exception-secret');
    });
    app.get('/events', (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
      reply.raw.end('data: stream-secret\n\n');
    });
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const request = await app.inject({
      method: 'POST',
      url: '/turn/path-secret?token=query-secret',
      headers: {
        traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
        authorization: 'Bearer header-secret',
        baggage: 'private=baggage-secret',
      },
      payload: { prompt: 'prompt-secret', arguments: 'tool-secret' },
    });
    expect(request.statusCode).toBe(200);
    expect(request.json()).toEqual({ traceId });
    expect(request.headers['x-trace-id']).toBe(traceId);
    expect((await app.inject('/error/path-secret')).statusCode).toBe(500);
    expect((await app.inject('/not-found-secret?token=query-secret')).statusCode).toBe(404);
    const stream = await app.inject('/events');
    expect(stream.body).toContain('stream-secret');
    expect(stream.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);
    expect(queuedTrace).toMatch(new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));
    // Simulate delayed dispatch after the originating HTTP request has already ended.
    await context.with(ROOT_CONTEXT, () =>
      observeQueueProcess(queuedTrace!, new Date(), async () => {
        expect(trace.getActiveSpan()?.spanContext().traceId).toBe(traceId);
        const turn = new TurnObservation();
        await turn.run(() =>
          observeProviderPrompt('acp-v2', async () => {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(captureTraceparent()).toMatch(new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));
            app.log.info('request completed');
            return { stopReason: 'end_turn' };
          }),
        );
        turn.finish('success', {});
        await expect(
          observeProviderPrompt('acp-v1', async () => {
            throw new Error('provider-error-secret');
          }),
        ).rejects.toThrow('provider-error-secret');
      }),
    );
    await app.close();
    const closing = runtime.shutdown();
    expect(runtime.shutdown()).toBe(closing);
    await closing;
    expect(received.some((item) => item.path === '/v1/traces')).toBe(true);
    expect(received.some((item) => item.path === '/v1/metrics')).toBe(true);
    expect(received.some((item) => item.path === '/v1/logs')).toBe(true);
    const exportedLogs = Buffer.concat(
      received.filter((item) => item.path === '/v1/logs').map((item) => item.body),
    );
    expect(exportedLogs.includes(Buffer.from(traceId, 'hex'))).toBe(true);
    expect(exportedLogs.includes(Buffer.from('queue.message.failed'))).toBe(true);
    expect(exportedLogs.includes(Buffer.from('Application log; details retained locally'))).toBe(
      true,
    );
    const exported = Buffer.concat(received.map((item) => item.body));
    for (const expected of [
      'agentctl-server',
      'service.instance.id',
      'POST /turn/:id',
      'agent.turn',
      'handler.ready',
      'agent.first_output',
      'agentctl.turn.duration',
      'agentctl.turn.phase.duration',
      'agentctl.agent.connection.events',
      'http.server.request.duration',
      'GET /events',
      'session.queue.send',
      'session.queue.process',
      'agent.provider.prompt',
      'provider.prompt.finished',
    ])
      expect(exported.includes(Buffer.from(expected)), expected).toBe(true);
    for (const forbidden of [
      'path-secret',
      'query-secret',
      'header-secret',
      'baggage-secret',
      'prompt-secret',
      'tool-secret',
      'exception-secret',
      'stream-secret',
      'not-found-secret',
      'resource-secret',
      'provider-secret',
      'log-field-secret',
      'log-error-secret',
      'dynamic-log-secret',
      'format-secret',
      'provider-error-secret',
      'extra-attribute-secret',
      process.cwd(),
    ])
      expect(exported.includes(Buffer.from(forbidden)), forbidden).toBe(false);
  } finally {
    await app.close();
    await runtime.shutdown();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
}, 15_000);

test('an unreachable collector cannot break requests or keep shutdown waiting indefinitely', async () => {
  vi.stubEnv('AGENTCTL_TELEMETRY', '1');
  vi.stubEnv('OTEL_SDK_DISABLED', '');
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
  vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', '');
  vi.stubEnv('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', '');
  const runtime = await startTelemetry('server');
  const app = Fastify({ logger: false });
  try {
    expect(runtime.enabled).toBe(true);
    instrumentHttp(app);
    app.get('/health', () => ({ ok: true }));
    expect((await app.inject('/health')).statusCode).toBe(200);
    await app.close();
    await runtime.shutdown();
  } finally {
    await app.close();
    await runtime.shutdown();
  }
}, 5000);

test('an existing log SDK remains owned by its host when AgentCtl initialization is rejected', async () => {
  const existing = { getLogger: () => ({ emit() {}, enabled: () => true }) };
  logs.setGlobalLoggerProvider(existing);
  vi.stubEnv('AGENTCTL_TELEMETRY', '1');
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1');
  try {
    const runtime = await startTelemetry('server');
    expect(runtime.enabled).toBe(false);
    expect(logs.getLoggerProvider()).toBe(existing);
    await runtime.shutdown();
  } finally {
    logs.disable();
  }
});
