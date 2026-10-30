import { afterEach, expect, it } from 'vite-plus/test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeReviewCheck, scrubReviewCheckText } from './review-check.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function cwd() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'review-check-'));
  directories.push(dir);
  return dir;
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const node = (script: string) => `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;
it('records actual exit status and separate output without an ACP connection', async () => {
  const result = await executeReviewCheck(
    node(
      "console.log('assertion failed'); console.error('expected 1, got 2'); process.exitCode = 7",
    ),
    await cwd(),
    5000,
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    status: 'failed',
    exitCode: 7,
    signal: null,
    error: null,
    stdout: 'assertion failed',
    stderr: 'expected 1, got 2',
  });
  expect(
    (
      await executeReviewCheck(
        node("console.log('ok')"),
        await cwd(),
        5000,
        new AbortController().signal,
      )
    ).status,
  ).toBe('passed');
});
it('redacts ANSI output, credentials, and app secrets even across chunks', async () => {
  const original = process.env.AGENTCTL_TEST_TOKEN;
  process.env.AGENTCTL_TEST_TOKEN = 'fixture-private-token-987654';
  try {
    const result = await executeReviewCheck(
      node(
        "process.stdout.write('Authorization: Bear'); setTimeout(() => { console.log('er fixture-private-token-987654'); console.log(process.env.AGENTCTL_TEST_TOKEN || 'app-secret-removed'); }, 30)",
      ),
      await cwd(),
      5000,
      new AbortController().signal,
    );
    expect(result.stdout).not.toContain('fixture-private-token');
    expect(result.stdout).toContain('app-secret-removed');
    expect(
      scrubReviewCheckText('\x1b[31mAuthorization: Bearer private-credential\x1b[0m'),
    ).not.toContain('private-credential');
  } finally {
    if (original === undefined) delete process.env.AGENTCTL_TEST_TOKEN;
    else process.env.AGENTCTL_TEST_TOKEN = original;
  }
});
it('bounds output and drops partial leading lines', async () => {
  const result = await executeReviewCheck(
    node("console.log('x'.repeat(100000)); console.log('last line')"),
    await cwd(),
    5000,
    new AbortController().signal,
  );
  expect(result.outputTruncated).toBe(true);
  expect(result.stdout.length).toBeLessThanOrEqual(48000);
  expect(result.stdout).toContain('last line');
});
it('times out and cancels the owned process group', async () => {
  const directory = await cwd();
  const file = path.join(directory, 'should-not-exist');
  const script = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('fs').writeFileSync(${JSON.stringify(file)}, 'alive'), 1200)`)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
  const timed = await executeReviewCheck(node(script), directory, 50, new AbortController().signal);
  expect(timed.status).toBe('timed_out');
  const controller = new AbortController();
  const pending = executeReviewCheck(
    node('setInterval(() => {}, 1000)'),
    directory,
    5000,
    controller.signal,
  );
  setTimeout(() => controller.abort(), 50);
  expect((await pending).status).toBe('cancelled');
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await expect(access(file)).rejects.toThrow();
});
it('saves launch errors and honours cancellation before launch', async () => {
  expect(
    (
      await executeReviewCheck(
        'true',
        path.join(await cwd(), 'missing'),
        1000,
        new AbortController().signal,
      )
    ).status,
  ).toBe('error');
  expect((await executeReviewCheck('true', await cwd(), 1000, AbortSignal.abort())).status).toBe(
    'cancelled',
  );
});
