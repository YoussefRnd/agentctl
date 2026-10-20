import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { cpus, platform, release, arch, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const workspace = resolve(import.meta.dirname, '../../..');
const output = resolve(process.argv[2] ?? join(workspace, 'performance-results/backend'));
const external = process.argv.includes('--collector');
const samples = [];
const failures = [];
const failedGroups = new Set();
const scenarios = [
  { sessions: 1, history: 200 },
  { sessions: 5, history: 200 },
  { sessions: 20, history: 200 },
  { sessions: 1, history: 10_000 },
];
await mkdir(output, { recursive: true });
const fingerprint = createHash('sha256');
const sources = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: workspace, encoding: 'utf8' },
)
  .split('\0')
  .filter(
    (file) =>
      /^(?:apps\/server\/(?:src|tests\/performance|scripts)|packages\/(?:core|shared)\/src|packages\/core\/drizzle)\//.test(
        file,
      ) || file === 'pnpm-lock.yaml',
  );
for (const file of [...new Set(sources)].sort())
  fingerprint
    .update(file)
    .update('\0')
    .update(await readFile(join(workspace, file)))
    .update('\0');
const report = {
  schemaVersion: 2,
  fixtureVersion: 2,
  generatedAt: new Date().toISOString(),
  passed: false,
  metadata: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    sourceHash: fingerprint.digest('hex'),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()
        .length > 0,
  },
  limitations: [
    'Synthetic provider; no ACP process or model/network latency.',
    'HTTP/SSE clients run in a child process; CPU/RSS/event-loop metrics cover the server and local telemetry receiver only.',
    'One discarded warmup and three fresh-process measured repetitions per workload and telemetry mode.',
    'Each process also discards one turn and history request per session before measurement.',
    'RSS peaks are sampled every 20ms; timings and memory are trends, not CI thresholds.',
    'Telemetry defaults to a local discard receiver; --collector explicitly exports to the configured backend.',
  ],
  samples,
  failures,
};

async function runSample(scenario, telemetry, repetition) {
  const name = `${scenario.sessions}-sessions-${scenario.history}-history-${telemetry}-${repetition < 0 ? 'warmup' : repetition}`;
  const file = join(output, `${name}.json`);
  await rm(file, { force: true });
  const temporary = await mkdtemp(join(tmpdir(), 'agentctl-backend-perf-'));
  const env = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' };
  // Ignore inherited endpoint/auth/sampling overrides unless the caller explicitly requests a backend.
  for (const key of Object.keys(env))
    if (key.startsWith('OTEL_') || key.startsWith('AGENTCTL_TELEMETRY')) delete env[key];
  if (external)
    for (const [key, value] of Object.entries(process.env))
      if (key.startsWith('OTEL_')) env[key] = value;
  let logs = '';
  const child = spawn(
    process.execPath,
    [
      'dist/tests/performance/sample.js',
      file,
      String(scenario.sessions),
      telemetry,
      String(scenario.history),
      external ? 'external' : 'discard',
      temporary,
    ],
    { cwd: resolve(import.meta.dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      logs = (logs + data).slice(-32_000);
    });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    await writeFile(join(output, `${name}.log`), logs);
    if (code !== 0) throw new Error(`${name} exited ${code}: ${logs.slice(-3000)}`);
    const sample = JSON.parse(await readFile(file, 'utf8'));
    if (!sample.passed || sample.schemaVersion !== 2) throw new Error(`Invalid sample: ${name}`);
    if (repetition >= 0) samples.push({ ...sample, repetition });
    console.log(`Passed ${name} (${Math.round(sample.elapsedMs)}ms)`);
  } finally {
    clearTimeout(timeout);
    // Remove SQLite/WAL files only after the child exits and releases its database handles.
    await rm(temporary, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  // Alternate order across repetitions to reduce systematic telemetry-on/off ordering effects.
  for (let repetition = -1; repetition < 3; repetition++)
    for (const telemetry of repetition % 2 === 0
      ? ['enabled', 'disabled']
      : ['disabled', 'enabled']) {
      const group = `${scenario.sessions}:${scenario.history}:${telemetry}`;
      if (failedGroups.has(group)) continue;
      try {
        await runSample(scenario, telemetry, repetition);
      } catch (error) {
        failedGroups.add(group);
        failures.push({ scenario, telemetry, repetition, error: String(error) });
        console.error(String(error));
      }
      await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    }
}
report.passed = failures.length === 0 && samples.length === scenarios.length * 2 * 3;
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const lines = [
  '# AgentCtl backend baseline',
  '',
  `Result: ${report.passed ? 'passed' : 'failed'}. Commit: ${report.metadata.commit}${report.metadata.dirty ? ' (working tree changes)' : ''}.`,
  '',
  'Each row is the median of three fresh-process runs. Completion p95 ends when the client parses SSE turn_end; CPU and RSS cover the server process. Values are synthetic workload trends, not real-provider tail latency.',
  '',
  '| Sessions | History/session | Telemetry | Turns/s | Accept p95 ms | History p95 ms | First output p95 ms | Completion p95 ms | Peak RSS MiB |',
  '| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const scenario of scenarios)
  for (const mode of ['disabled', 'enabled']) {
    const group = samples.filter(
      (sample) =>
        sample.workload.sessionCount === scenario.sessions &&
        sample.workload.historyEventsPerSession === scenario.history &&
        sample.workload.telemetry === mode,
    );
    if (group.length !== 3) {
      lines.push(`| ${scenario.sessions} | ${scenario.history} | ${mode} | incomplete | | | | | |`);
      continue;
    }
    const values = [
      median(group.map((x) => x.turnsPerSecond)),
      median(group.map((x) => x.acceptMs.p95)),
      median(group.map((x) => x.historyMs.p95)),
      median(group.map((x) => x.firstOutputMs.p95)),
      median(group.map((x) => x.completionMs.p95)),
      median(group.map((x) => x.memoryBytes.peakRss / 2 ** 20)),
    ];
    lines.push(
      `| ${scenario.sessions} | ${scenario.history} | ${mode} | ${values.map((x) => x.toFixed(1)).join(' | ')} |`,
    );
  }
lines.push(
  '',
  ...report.limitations.map((line) => `- ${line}`),
  '',
  ...failures.map((failure) => `- Failure: ${failure.error}`),
);
const summary = lines.join('\n') + '\n';
await writeFile(join(output, 'summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (!report.passed) process.exitCode = 1;
