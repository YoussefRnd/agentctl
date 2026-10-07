import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';

import { createJourneyApi, runJourneys } from './performance-journeys.mjs';

const journeys = process.argv.includes('--journeys');
const workerSmoke = process.argv.includes('--worker-smoke');
const production = journeys || process.argv.includes('--production');
const journeyApi = journeys ? createJourneyApi() : null;
const entryHtml = production ? 'index.html' : 'performance.html';
const webRoot = resolve(import.meta.dirname, '..');
const dist = process.env.AGENTCTL_PERF_DIST
  ? resolve(process.env.AGENTCTL_PERF_DIST)
  : join(webRoot, production ? 'dist' : 'dist-performance');
const output = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) ??
    join(webRoot, `../../performance-results/${journeys ? 'journeys' : 'baseline'}.json`),
);
const profile = await mkdtemp(join(tmpdir(), 'agentctl-performance-'));
let chrome;
let socket;
let server;
let send;
let chromeLogs = '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await readFile(join(dist, entryHtml)); // Fail before starting a browser if the build is missing.
  server = createServer(async (request, response) => {
    if (journeyApi && (await journeyApi.handle(request, response))) return;
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (workerSmoke && pathname === '/_performance-worker-smoke.html') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Markdown worker smoke</title>');
      return;
    }
    const file = resolve(dist, journeys && !extname(pathname) ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.woff2': 'font/woff2',
      };
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  chrome = spawn(
    process.env.CHROME_PATH ?? 'google-chrome',
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--window-size=1280,900',
      '--force-device-scale-factor=1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Chrome did not start. ${chromeLogs}`)),
      15_000,
    );
    chrome.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    chrome.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited (${code}). ${chromeLogs}`));
    });
    chrome.stderr.on('data', (chunk) => {
      chromeLogs = (chromeLogs + chunk.toString()).slice(-16_384);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(chromeLogs);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const debugOrigin = debuggerUrl.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const tabs = await (await fetch(`${debugOrigin}/json/list`)).json();
  const tab = tabs.find((entry) => entry.type === 'page');
  if (!tab) throw new Error('Chrome did not expose a page target.');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (
      message.method === 'Network.loadingFailed' &&
      !message.params.canceled &&
      message.params.blockedReason !== 'inspector'
    )
      errors.push(message.params.errorText);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      );
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  if (workerSmoke) await send('Page.navigate', { url: `${origin}/_performance-worker-smoke.html` });
  else if (!journeys) await send('Page.navigate', { url: `${origin}/performance.html` });
  await send('Page.bringToFront');
  const environment = {
    runner: 'Chrome headless, real-time frames, fresh browser profile',
    browser: (await send('Browser.getVersion')).product,
    node: process.version,
    commit: process.env.GITHUB_SHA ?? null,
    buildHash: createHash('sha256')
      .update(await readFile(join(dist, entryHtml)))
      .digest('hex'),
    host: { platform: platform(), arch: process.arch, cpuModel: cpus()[0]?.model },
  };
  const deadline = Date.now() + 180_000;
  while (
    (workerSmoke || !journeys) &&
    !(await evaluate(
      workerSmoke
        ? `document.title === 'Markdown worker smoke'`
        : `!!document.querySelector('button')`,
    ))
  ) {
    if (Date.now() > deadline || errors.length)
      throw new Error(`Lab failed to load. ${errors.join('\n')}`);
    await sleep(100);
  }
  if (workerSmoke) {
    const asset = (await readdir(join(dist, 'assets'))).find(
      (file) => file.startsWith('markdown.worker-') && file.endsWith('.js'),
    );
    if (!asset) throw new Error('Markdown worker asset is missing.');
    const result = await send('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const worker = new Worker(${JSON.stringify(`${origin}/assets/${asset}`)}, { type: 'module' });
        const finish = result => { clearTimeout(timer); worker.terminate(); resolve(result); };
        const timer = setTimeout(() => finish({error: 'worker timed out'}), 5000);
        worker.onerror = event => finish({error: event.message, filename: event.filename, line: event.lineno});
        worker.onmessage = event => finish(event.data);
        worker.postMessage({id: 1, content: '\u0060\u0060\u0060typescript\\nconst value = 42;\\n\u0060\u0060\u0060\\n\\n&amp; &copy; &NotEqualTilde;'});
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    const received = result.result?.value;
    if (result.exceptionDetails || received?.error || !received?.tree)
      throw new Error(
        `Markdown worker smoke failed: ${JSON.stringify(received ?? result.exceptionDetails)}`,
      );
    const nodes = [];
    function visit(node) {
      nodes.push(node);
      node.children?.forEach(visit);
    }
    visit(received.tree);
    if (
      !nodes.some((node) => node.properties?.className?.includes('hljs-keyword')) ||
      !nodes.some((node) => node.type === 'text' && node.value.includes('& © ≂̸'))
    )
      throw new Error('Markdown worker lost syntax highlighting or named entities.');
    console.log('Markdown worker smoke passed: highlighted code and named entities.');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ passed: true, environment }, null, 2) + '\n');
  } else {
    if (!journeys)
      await evaluate(
        process.argv.includes('--stream-probe')
          ? `[...document.querySelectorAll('button')].find(button => button.textContent === 'Run stream probe').click()`
          : `document.querySelector('button').click()`,
      );
    let previousStatus = '';
    let report = journeys
      ? await runJourneys({ send, evaluate, origin, api: journeyApi, errors })
      : undefined;
    while (!report && Date.now() < deadline) {
      await sleep(1000);
      const state = await evaluate(
        `({ report: document.getElementById('performance-report')?.textContent, status: document.querySelector('[role=status]')?.textContent, running: document.querySelector('button')?.disabled })`,
      );
      if (state.status !== previousStatus) {
        console.log(state.status);
        previousStatus = state.status;
      }
      if (errors.length) throw new Error(errors.join('\n'));
      if (state.report) {
        report = JSON.parse(state.report);
        break;
      }
      if (!state.running) throw new Error(`Suite did not complete: ${state.status}`);
    }
    if (!report) throw new Error('Performance suite timed out.');
    Object.assign(report.environment, environment);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      `Saved ${report.scenarios.length} browser samples and ${report.cpu.length} CPU baselines to ${output}`,
    );
    await send('Page.captureScreenshot', { format: 'png' }).then(async ({ data }) => {
      await writeFile(output.replace(/\.json$/, '') + '.png', Buffer.from(data, 'base64'));
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output.replace(/\.json$/, '') + '.failure.json',
    JSON.stringify({ error: String(error), generatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  if (send) {
    try {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(output.replace(/\.json$/, '') + '.failure.png', Buffer.from(data, 'base64'));
    } catch {
      // The original failure remains useful when Chrome itself is unavailable.
    }
  }
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([closed, sleep(2000)]);
    if (chrome.exitCode === null) {
      chrome.kill('SIGKILL');
      await closed;
    }
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
