import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { budgets, checkReport, trendRows } from './performance-budgets.mjs';

const output = resolve(
  process.argv[2] ?? join(import.meta.dirname, '../../../performance-results/check'),
);
await mkdir(output, { recursive: true });
await rm(join(output, 'checks.json'), { force: true });
await rm(join(output, 'summary.md'), { force: true });
const checks = [];
const trends = [];
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Process exited ${code ?? signal}`)),
    );
  });
const browser = join(import.meta.dirname, 'performance-browser.mjs');
const suites = [
  [
    'budget-tests',
    ['--test', '--test-isolation=none', join(import.meta.dirname, 'performance-budgets.test.mjs')],
  ],
  ['worker', [browser, join(output, 'worker.json'), '--worker-smoke']],
  [
    'production-worker',
    [browser, join(output, 'production-worker.json'), '--production', '--worker-smoke'],
  ],
  ['components', [browser, join(output, 'components.json')]],
  ['stream', [browser, join(output, 'stream.json'), '--stream-probe']],
  ['journeys', [browser, join(output, 'journeys.json'), '--journeys']],
];
for (const [name, args] of suites) {
  console.log(`\nPerformance check: ${name}`);
  try {
    // Remove only this suite's generated artifacts, so a failed rerun cannot upload stale success.
    for (const suffix of ['.json', '.png', '.failure.json', '.failure.png']) {
      await rm(join(output, name + suffix), { force: true });
    }
    await run(args);
    if (['components', 'stream', 'journeys'].includes(name)) {
      const report = JSON.parse(await readFile(join(output, `${name}.json`), 'utf8'));
      checkReport(name, report);
      trends.push(...trendRows(name, report));
    }
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    console.error(`${name}: ${error.message}`);
    // Continue independent suites so a regression still leaves useful artifacts.
  }
}
const summary = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  budgets,
  checks,
  trends,
};
await writeFile(join(output, 'checks.json'), JSON.stringify(summary, null, 2) + '\n');
const markdown = [
  '## Web performance checks',
  '',
  ...checks.map(
    (c) =>
      `- ${c.passed ? 'PASS' : 'FAIL'} ${c.name}${c.error ? `: ${c.error.replace(/[\r\n]/g, ' ')}` : ''}`,
  ),
  '',
  `Startup JavaScript budget: ${budgets.startupJavaScriptBytes.toLocaleString('en-US')} decoded bytes.`,
  'Queue/turn subscriber commits: 0; prompt commits: at most 1 per 16-delta sample.',
  '',
  'Timing medians are trends, without pass/fail thresholds. These synthetic browser fixtures exclude real backend/provider and native startup.',
  '',
  '| Measurement | Median (ms) |',
  '| --- | ---: |',
  ...trends.map(([name, value]) => `| ${name} | ${value.toFixed(1)} |`),
  '',
].join('\n');
await writeFile(join(output, 'summary.md'), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
if (checks.some((check) => !check.passed)) process.exitCode = 1;
