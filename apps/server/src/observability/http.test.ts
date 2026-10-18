import { get } from 'node:http';
import { once } from 'node:events';
import Fastify from 'fastify';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  TracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace';
import { expect, test } from 'vite-plus/test';
import { instrumentHttp } from './http.js';

function fixture() {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  trace.setGlobalTracerProvider(provider);
  const app = Fastify({ logger: false });
  instrumentHttp(app);
  return { exporter, provider, app };
}

test('HTTP spans use route templates, classify server errors and omit unknown routes', async () => {
  const { exporter, provider, app } = fixture();
  app.get('/failure/:id', (_request, reply) => reply.code(503).send({ ok: false }));
  try {
    expect((await app.inject('/failure/private-path')).statusCode).toBe(503);
    expect((await app.inject('/unknown-private-path')).statusCode).toBe(404);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].name).toBe('GET /failure/:id');
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].attributes).toMatchObject({
      'http.response.status_code': 503,
      'error.type': '503',
    });
    expect(spans[1].name).toBe('GET');
    expect(spans[1].attributes).not.toHaveProperty('http.route');
    expect(spans[1].status.code).toBe(SpanStatusCode.UNSET);
  } finally {
    await app.close();
    await provider.shutdown();
    trace.disable();
  }
});

test('a real disconnected stream ends once and records a bounded connection failure', async () => {
  const { exporter, provider, app } = fixture();
  app.get('/stream/:id', (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('data: private-stream-content\n\n');
  });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const request = get(`${address}/stream/private-path`);
    request.on('error', () => undefined);
    const [response] = await once(request, 'response');
    response.once('data', () => response.destroy());
    await once(response, 'close');
    await expect.poll(() => exporter.getFinishedSpans().length).toBe(1);
    const span = exporter.getFinishedSpans()[0];
    expect(span.name).toBe('GET /stream/:id');
    expect(response.headers['x-trace-id']).toBe(span.spanContext().traceId);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes).toMatchObject({
      'http.response.status_code': 200,
      'error.type': 'connection_closed',
    });
    expect(JSON.stringify(span.attributes)).not.toContain('private');
  } finally {
    await app.close();
    await provider.shutdown();
    trace.disable();
  }
});
