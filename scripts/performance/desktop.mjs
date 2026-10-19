import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const workspace = resolve(import.meta.dirname, '../..');
const output = resolve(process.argv[2] ?? 'performance-results/desktop');
await mkdir(output, { recursive: true });
const buildRoot = join(workspace, 'apps/desktop/out');
const fingerprint = createHash('sha256');
const artifacts = (await readdir(buildRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
for (const file of artifacts)
  fingerprint
    .update(relative(buildRoot, file).replaceAll('\\', '/'))
    .update('\0')
    .update(await readFile(file))
    .update('\0');
const phases = [
  'desktop-process-to-app-ready',
  'desktop-server-start-to-ready',
  'desktop-window-create-to-ready',
  'desktop-process-to-window-ready',
];
const report = {
  schemaVersion: 1,
  passed: false,
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  dirty:
    execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()
      .length > 0,
  buildHash: fingerprint.digest('hex'),
  cpu: cpus()[0]?.model,
  samples: [],
  error: undefined,
};
try {
  for (let repetition = -1; repetition < 3; repetition++) {
    const file = join(output, `${repetition < 0 ? 'warmup' : repetition}.json`);
    const env = { ...process.env, AGENTCTL_TELEMETRY: '0' };
    const child = spawn(process.execPath, ['scripts/desktop-smoke.mjs', file, '--startup-only'], {
      cwd: workspace,
      env,
      stdio: 'inherit',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    if (code !== 0) throw new Error(`Native startup exited ${code}; see ${file}.log`);
    const sample = JSON.parse(await readFile(file, 'utf8')).reports[0];
    for (const phase of phases) {
      const matches = sample.startup.filter((metric) => metric.name === phase);
      if (
        matches.length !== 1 ||
        !Number.isFinite(matches[0].durationMs) ||
        matches[0].durationMs < 0
      )
        throw new Error(`Missing/invalid startup phase: ${phase}`);
    }
    if (repetition >= 0) report.samples.push({ repetition, ...sample });
  }
  report.passed = report.samples.length === 3;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
}
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const lines = [
  '# AgentCtl native startup baseline',
  '',
  'One discarded warmup, three measured launches with fresh database/profile. Built Electron app under the native lifecycle smoke; renderer typeability is measured separately by the browser suite. Timings are trends, not CI thresholds.',
  '',
  '| Phase | Median ms |',
  '| --- | ---: |',
];
for (const phase of phases) {
  const values = report.samples
    .map((sample) => sample.startup.find((metric) => metric.name === phase).durationMs)
    .sort((a, b) => a - b);
  if (values.length === 3) lines.push(`| ${phase} | ${values[1].toFixed(1)} |`);
}
if (report.error) lines.push('', report.error);
const summary = lines.join('\n') + '\n';
await writeFile(join(output, 'summary.md'), summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
