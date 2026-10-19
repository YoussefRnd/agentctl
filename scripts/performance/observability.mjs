import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const base = new URL(process.env.AGENTCTL_GRAFANA_URL ?? 'http://127.0.0.1:3001');
const directory = resolve(import.meta.dirname, '../../observability/grafana/dashboards');
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}
let checked = 0;
for (const file of (await readdir(directory)).filter((file) => file.endsWith('.json'))) {
  const source = JSON.parse(await readFile(join(directory, file), 'utf8'));
  const saved = await get(`/api/dashboards/uid/${source.uid}`);
  assert(saved.meta.provisioned, `${source.uid} must be provisioned from the repository`);
  assert.equal(saved.dashboard.panels.length, source.panels.length);
  assert.deepEqual(
    saved.dashboard.panels.map((panel) => panel.targets.map((target) => target.expr)),
    source.panels.map((panel) => panel.targets.map((target) => target.expr)),
    'Provisioned queries must match the current definitions',
  );
  for (const panel of source.panels)
    for (const target of panel.targets) {
      const query = target.expr
        .replaceAll('$service', 'agentctl-.*')
        .replaceAll('$instance', '.*')
        .replaceAll('$__rate_interval', '5m');
      const path =
        panel.datasource.type === 'loki'
          ? '/api/datasources/proxy/uid/loki/loki/api/v1/query_range'
          : '/api/datasources/proxy/uid/prometheus/api/v1/query';
      const result = await get(
        `${path}?${new URLSearchParams({ query, ...(panel.type === 'logs' ? { limit: '1' } : {}) })}`,
      );
      assert.equal(result.status, 'success', `${source.uid}: ${panel.title}`);
      checked++;
    }
  // Dynamic selectors must resolve against the stack's actual resource-label mapping.
  const series = await get(
    `/api/datasources/proxy/uid/prometheus/api/v1/series?${new URLSearchParams({ 'match[]': 'agentctl_process_memory_bytes{service_name=~"agentctl-.*"}' })}`,
  );
  assert.equal(series.status, 'success');
  if (process.argv.includes('--require-data'))
    assert(
      series.data.some((item) => item.service_instance_id),
      'Export telemetry before requiring resource data',
    );
  console.log(
    `Verified ${source.title}: provisioned, ${source.panels.length} panel queries accepted`,
  );
}
if (process.argv.includes('--require-data')) {
  for (const metric of [
    'agentctl_process_memory_bytes',
    'agentctl_process_cpu_time_seconds_total',
    'agentctl_process_event_loop_delay_seconds',
    'agentctl_process_event_loop_utilization_ratio',
    'agentctl_turn_duration_seconds_count',
    'agentctl_queue_wait_duration_seconds_count',
    'http_server_request_duration_seconds_count',
  ]) {
    const result = await get(
      `/api/datasources/proxy/uid/prometheus/api/v1/query?${new URLSearchParams({ query: `count_over_time(${metric}{service_name=~"agentctl-.*"}[1h])` })}`,
    );
    assert(result.data.result.length > 0, `No recent data for ${metric}`);
  }
}
console.log(
  `All ${checked} dashboard queries passed. Empty panels are valid when their workload has not run.`,
);
