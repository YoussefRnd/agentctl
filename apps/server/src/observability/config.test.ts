import { expect, test } from 'vite-plus/test';
import { telemetryConfig } from './config.js';

test('telemetry is inert unless explicitly enabled and respects the SDK kill switch', () => {
  expect(telemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'not a URL' })).toEqual({ enabled: false });
  expect(telemetryConfig({ AGENTCTL_TELEMETRY: '1', OTEL_SDK_DISABLED: 'true' })).toEqual({
    enabled: false,
  });
  expect(telemetryConfig({ AGENTCTL_TELEMETRY: '1', OTEL_SDK_DISABLED: 'TRUE' })).toEqual({
    enabled: false,
  });
});

test('per-signal endpoints and protocols override unused generic values and empty options use defaults', () => {
  expect(
    telemetryConfig({
      AGENTCTL_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'invalid',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1/traces',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1/metrics',
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1/logs',
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/protobuf',
    }),
  ).toMatchObject({
    enabled: true,
    tracesUrl: 'http://127.0.0.1/traces',
    logsUrl: 'http://127.0.0.1/logs',
  });
  expect(
    telemetryConfig({
      AGENTCTL_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      AGENTCTL_TELEMETRY_SAMPLE_RATIO: '',
    }),
  ).toMatchObject({ enabled: true, sampleRatio: 1, logsUrl: 'http://127.0.0.1:4318/v1/logs' });
});

test('OTLP base URLs keep their prefix and signal-specific URLs are used exactly', () => {
  expect(
    telemetryConfig({
      AGENTCTL_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318/collector/',
    }),
  ).toEqual({
    enabled: true,
    tracesUrl: 'http://127.0.0.1:4318/collector/v1/traces',
    metricsUrl: 'http://127.0.0.1:4318/collector/v1/metrics',
    logsUrl: 'http://127.0.0.1:4318/collector/v1/logs',
    sampleRatio: 1,
  });
  expect(
    telemetryConfig({
      AGENTCTL_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.example/traces',
      AGENTCTL_TELEMETRY_SAMPLE_RATIO: '0.1',
    }),
  ).toMatchObject({
    enabled: true,
    tracesUrl: 'https://collector.example/traces',
    sampleRatio: 0.1,
  });
});

test('invalid endpoints, protocols and sampling cannot silently enable an unsafe exporter', () => {
  for (const value of ['file:///tmp/export', 'http://user:password@localhost:4318', 'invalid'])
    expect(() =>
      telemetryConfig({ AGENTCTL_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: value }),
    ).toThrow();
  for (const value of ['NaN', '-1', '1.01'])
    expect(() =>
      telemetryConfig({ AGENTCTL_TELEMETRY: '1', AGENTCTL_TELEMETRY_SAMPLE_RATIO: value }),
    ).toThrow();
  expect(() =>
    telemetryConfig({ AGENTCTL_TELEMETRY: '1', OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }),
  ).toThrow();
});
