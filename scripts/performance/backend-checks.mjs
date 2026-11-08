import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { cpus, platform, release, arch, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateDecoding, median } from './decoding-budget.mjs';
import { repositoryFiles } from '../architecture/workspace.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const [kind, destination, ...args] = process.argv.slice(2);
if (!['decoding', 'soak'].includes(kind)) throw new Error('Expected decoding or soak');
const output = resolve(destination ?? join(workspace, 'performance-results', kind));
const seconds = args.length ? Number(args[0]) : 300;
const fullRetention = args.slice(1).includes('--full-retention');
if (args.slice(1).some((arg) => arg !== '--full-retention'))
  throw new Error('Unknown benchmark option');
if (kind === 'soak' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600))
  throw new Error('Soak duration must be 1–3600 seconds');
await mkdir(output, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });
const fingerprint = createHash('sha256');
for (const file of (await repositoryFiles(workspace)).filter(
  (file) =>
    /^(apps\/server\/|packages\/(core|shared)\/src\/|packages\/core\/drizzle\/|scripts\/performance\/)/.test(
      file,
    ) || file === 'pnpm-lock.yaml',
)) {
  fingerprint
    .update(file)
    .update('\0')
    .update(await readFile(join(workspace, file)))
    .update('\0');
}
const report = {
  schemaVersion: 1,
  kind,
  passed: false,
  generatedAt: new Date().toISOString(),
  metadata: {
    commit: git('rev-parse', 'HEAD').trim(),
    dirty: !!git('status', '--porcelain').trim(),
    sourceHash: fingerprint.digest('hex'),
    node: process.version,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  samples: [],
  budget: undefined,
  error: undefined,
};

async function capture(name) {
  const temporary = await mkdtemp(join(tmpdir(), 'agentctl-backend-check-'));
  const file = join(output, `${name}.json`);
  await rm(file, { force: true });
  const env = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' };
  for (const key of Object.keys(env))
    if (key.startsWith('OTEL_') || key.startsWith('AGENTCTL_TELEMETRY')) delete env[key];
  let logs = '';
  let child;
  let timer;
  try {
    child = spawn(
      process.execPath,
      [
        `dist/tests/performance/${kind === 'decoding' ? 'row-decoding' : 'soak'}.js`,
        file,
        ...(kind === 'soak' ? [String(seconds), temporary, fullRetention ? '10000' : '0'] : []),
      ],
      { cwd: join(workspace, 'apps/server'), env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => {
        logs = (logs + data).slice(-32_000);
      });
    timer = setTimeout(() => child.kill('SIGKILL'), (kind === 'soak' ? seconds + 90 : 90) * 1000);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0) throw new Error(`${name} exited ${code}: ${logs.slice(-3000)}`);
    const sample = JSON.parse(await readFile(file, 'utf8'));
    if (!sample.passed || sample.schemaVersion !== 1) throw new Error(`Invalid sample: ${name}`);
    if (
      kind === 'soak' &&
      fullRetention &&
      (sample.workload.initialChangesPerSession !== 10000 ||
        sample.retainedChanges?.length !== 20 ||
        sample.retainedChanges.some((row) => row.count !== 10000))
    )
      throw new Error(
        'Full-retention soak must preserve exactly 10000 journal entries per session',
      );
    console.log(`Passed ${kind}/${name}`);
    return sample;
  } finally {
    clearTimeout(timer);
    try {
      await writeFile(join(output, `${name}.log`), logs);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

try {
  if (kind === 'decoding') {
    await capture('warmup');
    for (let i = 0; i < 3; i++) report.samples.push(await capture(String(i)));
    report.budget = evaluateDecoding(report.samples);
    report.passed = report.budget.every((row) => row.passed);
  } else {
    report.samples.push(await capture('soak'));
    report.passed = true;
  }
} catch (error) {
  report.error = String(error);
}
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const lines = [
  `# AgentCtl ${kind} check`,
  '',
  `Result: ${report.passed ? 'passed' : 'failed'}.`,
  '',
];
if (kind === 'decoding') {
  lines.push(
    'Two discarded stage warmups and seven measured repetitions per process. One discarded process and three fresh measured processes. Ratios use full decoding against the preserved intersection-based reference on the same host.',
    '',
    '| Rows | Mixed events | Candidate/reference median | Limit |',
    '| ---: | --- | ---: | ---: |',
  );
  for (const row of report.budget ?? [])
    lines.push(`| ${row.count} | ${row.mixed} | ${row.ratio.toFixed(3)} | ${row.limit} |`);
  lines.push(
    '',
    'The 1.25 ratio is a coarse regression guard, not an absolute latency SLO. Application latency budgets need historical CI variance.',
  );
} else if (report.samples.length) {
  const sample = report.samples[0];
  const size = Math.max(1, Math.floor(sample.waves.length / 5));
  const early = sample.waves.slice(0, size);
  const late = sample.waves.slice(-size);
  lines.push(
    `${sample.turns} turns over ${(sample.elapsedMs / 1000).toFixed(1)}s across 20 sessions with persistent SSE connections. Queue drained; listeners closed.`,
    `Initial journal entries per session: ${sample.workload.initialChangesPerSession ?? 0}.`,
    '',
    '| Metric | First 20% of batches | Last 20% of batches |',
    '| --- | ---: | ---: |',
  );
  for (const [label, get] of [
    ['Batch ms', (x) => x.durationMs],
    ['History p95 ms', (x) => x.historyMs.p95],
    ['Completion p95 ms', (x) => x.completionMs.p95],
  ])
    lines.push(
      `| ${label} | ${median(early.map(get)).toFixed(1)} | ${median(late.map(get)).toFixed(1)} |`,
    );
  lines.push(
    '',
    `Peak RSS: ${(Math.max(...sample.samples.map((x) => x.rss)) / 2 ** 20).toFixed(1)} MiB. Natural-GC heap low-water windows are in soak.json.`,
    '',
    'Synthetic provider and telemetry disabled. Durable history grows throughout. Memory and timing are diagnostic trends, not leak proofs or host-specific CI limits.',
  );
}
if (report.error) lines.push('', report.error);
const summary = lines.join('\n') + '\n';
await writeFile(join(output, 'summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
if (!report.passed) process.exitCode = 1;
