import {
  context,
  metrics,
  trace,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);
type Failure = 'connection_closed' | 'shutdown';

/** Manual hooks work in Node ESM and bundled Electron without module patching. */
export function instrumentHttp(app: FastifyInstance): void {
  const tracer = trace.getTracer('agentctl.http');
  const duration = metrics
    .getMeter('agentctl.http')
    .createHistogram('http.server.request.duration', { unit: 's' });
  const propagator = new W3CTraceContextPropagator();
  const active = new Set<(failure?: Failure) => void>();
  const requests = new WeakMap<FastifyRequest, (failure?: Failure) => void>();
  app.addHook('onRequest', (request, reply, done) => {
    const method = methods.has(request.method) ? request.method : '_OTHER';
    const route = request.routeOptions.url;
    const attributes = { 'http.request.method': method, ...(route ? { 'http.route': route } : {}) };
    // Extract only the standard trace ID header, never baggage or arbitrary header data.
    const parent = propagator.extract(
      ROOT_CONTEXT,
      { traceparent: request.headers.traceparent },
      {
        keys: () => ['traceparent'],
        get: (carrier, key) => carrier[key as 'traceparent'],
      },
    );
    const span = tracer.startSpan(
      route ? `${method} ${route}` : method,
      { kind: SpanKind.SERVER, attributes },
      parent,
    );
    const startedAt = performance.now();
    let ended = false;
    const onFinish = () => finish();
    const onClose = () => finish(reply.raw.writableFinished ? undefined : 'connection_closed');
    const finish = (failure?: Failure) => {
      if (ended) return;
      ended = true;
      active.delete(finish);
      reply.raw.removeListener('finish', onFinish);
      reply.raw.removeListener('close', onClose);
      const status = reply.raw.headersSent ? reply.statusCode : undefined;
      const result = {
        ...(status !== undefined ? { 'http.response.status_code': status } : {}),
        ...(failure || (status !== undefined && status >= 500)
          ? { 'error.type': failure ?? String(status) }
          : {}),
      };
      span.setAttributes(result);
      if ('error.type' in result) span.setStatus({ code: SpanStatusCode.ERROR });
      duration.record(Math.max(0, performance.now() - startedAt) / 1000, {
        ...attributes,
        ...result,
      });
      span.end();
    };
    active.add(finish);
    requests.set(request, finish);
    reply.raw.once('finish', onFinish);
    reply.raw.once('close', onClose);
    const spanContext = span.spanContext();
    // Raw SSE responses bypass Fastify's header store after reply.hijack().
    if (isSpanContextValid(spanContext)) reply.raw.setHeader('x-trace-id', spanContext.traceId);
    context.with(trace.setSpan(parent, span), done);
  });
  app.addHook('onResponse', async (request) => {
    requests.get(request)?.();
  });
  app.addHook('onRequestAbort', async (request) => {
    requests.get(request)?.('connection_closed');
  });
  app.addHook('onClose', async () => {
    for (const finish of active) finish('shutdown');
  });
}
