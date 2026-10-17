import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
const workspace = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? 'performance-results/native-smoke.json');
const require = createRequire(join(workspace, 'apps/desktop/package.json'));
const electron = require('electron');
const temporary = await mkdtemp(join(tmpdir(), 'agentctl-native-'));
let display;
let displayProcess;
let child;
try {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    displayProcess = spawn(
      process.env.XVFB_PATH ?? 'Xvfb',
      ['-displayfd', '1', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    display = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Xvfb did not start; install Xvfb or set XVFB_PATH')),
        10000,
      );
      displayProcess.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      displayProcess.stdout.once('data', (data) => {
        clearTimeout(timer);
        resolve(':' + data.toString().trim());
      });
      displayProcess.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Xvfb exited (${code})`));
      });
    });
  }
  const reports = [];
  for (const failure of [false, true]) {
    const scenario = join(temporary, failure ? 'failure' : 'startup');
    await mkdir(scenario);
    const scenarioOutput = join(scenario, 'report.json');
    let logs = '';
    child = spawn(
      electron,
      ['--disable-gpu', join(workspace, 'apps/desktop/scripts/native-smoke.cjs')],
      {
        cwd: scenario,
        env: {
          ...process.env,
          ...(display ? { DISPLAY: display } : {}),
          AGENTCTL_SMOKE_OUTPUT: scenarioOutput,
          AGENTCTL_SMOKE_BUILD: join(workspace, 'apps/desktop/out'),
          AGENTCTL_SMOKE_FAILURE: failure ? '1' : '0',
          DATABASE_URL: join(scenario, 'agentctl.db'),
          AGENTCTL_HOME: join(scenario, 'home'),
          ELECTRON_RENDERER_URL: '',
          LOG_LEVEL: 'warn',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => {
        logs = (logs + data).slice(-64000);
      });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output + '.log', logs);
    let report;
    try {
      report = JSON.parse(await readFile(scenarioOutput, 'utf8'));
    } catch {
      throw new Error(`Native smoke exited ${code} without a report.\n${logs}`);
    }
    reports.push({ ...report, exitCode: code });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      JSON.stringify({ passed: reports.every((item) => item.passed), reports }, null, 2) + '\n',
    );
    await writeFile(output + '.log', logs);
    if (!report.passed || code !== (failure ? 1 : 0))
      throw new Error(`Native smoke failed. See ${output}\n${logs}`);
  }
  console.log(
    `Native Electron startup, IPC, server shutdown and startup-failure smoke passed: ${output}`,
  );
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL');
  displayProcess?.kill();
  await rm(temporary, { recursive: true, force: true });
}
