import { randomUUID } from 'node:crypto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  TracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InstrumentType,
  AggregationType,
} from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import type { TelemetryConfig } from './config.js';
import { startProcessMetrics } from './process-metrics.js';

const batchOptions = {
  maxQueueSize: 512,
  maxExportBatchSize: 128,
  scheduledDelayMillis: 5000,
  exportTimeoutMillis: 1500,
};
type Provider = { shutdown(): Promise<void> };

async function shutdownProviders(providers: Provider[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(
        providers.map((provider) => Promise.resolve().then(() => provider.shutdown())),
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Loaded only by an explicitly enabled host; construction cleans up even after partial failure. */
export async function createSdk(
  config: Extract<TelemetryConfig, { enabled: true }>,
  serviceName: string,
) {
  const providers: Provider[] = [];
  try {
    const resource = resourceFromAttributes({
      'service.name': serviceName,
      'service.instance.id': randomUUID(),
    });
    const tracer = new TracerProvider({
      resource,
      spanLimits: { attributeCountLimit: 16, attributeValueLengthLimit: 256, eventCountLimit: 8 },
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(config.sampleRatio),
      }),
      spanProcessors: [
        new BatchSpanProcessor({
          exporter: new OTLPTraceExporter({ url: config.tracesUrl, timeoutMillis: 1000 }),
          ...batchOptions,
        }),
      ],
    });
    providers.push(tracer);
    const meter = new MeterProvider({
      resource,
      views: [
        {
          instrumentName: 'http.server.request.duration',
          instrumentType: InstrumentType.HISTOGRAM,
          aggregationCardinalityLimit: 512,
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: {
              boundaries: [
                0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
              ],
            },
          },
        },
        {
          instrumentName: 'agentctl.*',
          instrumentType: InstrumentType.HISTOGRAM,
          aggregationCardinalityLimit: 512,
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: {
              boundaries: [
                0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600,
              ],
            },
          },
        },
        {
          instrumentName: '*',
          instrumentType: InstrumentType.COUNTER,
          aggregationCardinalityLimit: 512,
        },
      ],
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: config.metricsUrl, timeoutMillis: 1000 }),
          exportIntervalMillis: 10_000,
          exportTimeoutMillis: 1500,
        }),
      ],
    });
    providers.push(meter);
    const logger = new LoggerProvider({
      resource,
      logRecordLimits: { attributeCountLimit: 16, attributeValueLengthLimit: 256 },
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: config.logsUrl, timeoutMillis: 1000 }),
          ...batchOptions,
        }),
      ],
    });
    providers.push(logger);
    const stopProcessMetrics = startProcessMetrics(meter);
    return {
      tracer,
      meter,
      logger,
      manager: new AsyncLocalStorageContextManager(),
      shutdown: () => shutdownProviders(providers).finally(stopProcessMetrics),
    };
  } catch (error) {
    await shutdownProviders(providers);
    throw error;
  }
}

export type TelemetrySdk = Awaited<ReturnType<typeof createSdk>>;
