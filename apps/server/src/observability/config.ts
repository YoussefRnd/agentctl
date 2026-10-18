export type TelemetryConfig =
  | { enabled: false }
  | { enabled: true; tracesUrl: string; metricsUrl: string; logsUrl: string; sampleRatio: number };

function endpoint(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Telemetry requires an HTTP(S) OTLP endpoint without URL credentials.');
  return url;
}

export function telemetryConfig(env: NodeJS.ProcessEnv): TelemetryConfig {
  if (env.AGENTCTL_TELEMETRY !== '1' || env.OTEL_SDK_DISABLED?.toLowerCase() === 'true')
    return { enabled: false };
  const signalUrl = (signal: 'traces' | 'metrics' | 'logs') => {
    const prefix = `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}`;
    const protocol =
      env[`${prefix}_PROTOCOL`] || env.OTEL_EXPORTER_OTLP_PROTOCOL || 'http/protobuf';
    if (protocol !== 'http/protobuf')
      throw new Error('AgentCtl telemetry uses OTLP HTTP/protobuf.');
    const override = env[`${prefix}_ENDPOINT`];
    if (override) return endpoint(override).href;
    const url = endpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318');
    url.pathname = url.pathname.replace(/\/$/, '') + `/v1/${signal}`;
    return url.href;
  };
  const sampleRatio = Number(env.AGENTCTL_TELEMETRY_SAMPLE_RATIO?.trim() || '1');
  if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1)
    throw new Error('Telemetry sample ratio must be between zero and one.');
  return {
    enabled: true,
    tracesUrl: signalUrl('traces'),
    metricsUrl: signalUrl('metrics'),
    logsUrl: signalUrl('logs'),
    sampleRatio,
  };
}
