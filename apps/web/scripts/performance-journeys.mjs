import { performance } from 'node:perf_hooks';

export const JOURNEY_FIXTURE_VERSION = 1;

export const journeyIds = Array.from(
  { length: 4 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
);
const projectId = '00000000-0000-4000-8000-000000000099';
const timestamp = '2026-10-07T10:00:00.000Z';
const project = {
  id: projectId,
  name: 'Journey fixture',
  path: '/synthetic',
  repoRoot: null,
  subdir: '',
};
const sessions = journeyIds.map((id, i) => ({
  id,
  projectId,
  project,
  agent: 'synthetic',
  mode: 'local',
  branch: 'main',
  baseCommit: 'fixture',
  taskSlug: `journey-${i}`,
  title: `Journey ${i}`,
  worktreePath: '/synthetic',
  agentSessionId: null,
  status: 'idle',
  totalTokens: 0,
  contextLimit: 100000,
  estimatedCost: 0,
  lastHeartbeat: null,
  closedAt: null,
  lastActivityAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  selectedProvider: 'synthetic',
  selectedModel: 'fixture',
  selectedThinkingEffort: 'medium',
  approvalMode: 'review',
  agentPersona: null,
  availableAgentPersonas: [],
  availableCommands: [],
  sessionConfigOptions: [],
  sessionMetrics: {},
  plan: [],
  planArtifacts: [],
}));
const events = (sessionId) =>
  Array.from({ length: 200 }, (_, i) => ({
    id: i + 1,
    sessionId,
    type: 'text',
    createdAt: timestamp,
    data: {
      role: i % 2 === 0 ? 'user' : 'provider',
      content:
        i % 2 === 0
          ? `Fixture prompt ${i / 2}`
          : `Journey ${journeyIds.indexOf(sessionId)} answer ${i}: measured production navigation.`,
    },
  }));

/** Only synthetic GETs. Unexpected requests fail the benchmark; no backend is contacted. */
export function createJourneyApi(delayMs = 120) {
  const requests = [];
  const failures = [];
  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const startedAt = performance.now();
    const row = { path: url.pathname, startedAt, finishedAt: null };
    requests.push(row);
    if (request.method !== 'GET') {
      failures.push(`Unexpected mutation: ${request.method} ${url.pathname}`);
      response.writeHead(405).end();
      return true;
    }
    if (url.pathname.endsWith('/stream')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      response.write(': connected\n\n');
      row.finishedAt = performance.now();
      return true;
    }
    let body;
    if (url.pathname === '/api/settings')
      body = {
        onboardingCompleted: true,
        onboardingVersion: '1',
        setupStep: null,
        defaultProviderId: null,
        showThinking: true,
        defaultToWorktree: false,
        registrySyncError: null,
        fontConfig: { ui: { family: 'Inter', size: 13 }, code: { family: 'monospace', size: 13 } },
      };
    else if (url.pathname === '/api/projects')
      body = [
        {
          ...project,
          createdAt: timestamp,
          updatedAt: timestamp,
          isGitRepo: false,
          sessions,
          lastActiveTime: 0,
        },
      ];
    else if (url.pathname === '/api/editor/available') body = [];
    else if (
      ['/api/providers', '/api/registry', '/api/mcp-servers', '/api/mcp/tools'].includes(
        url.pathname,
      )
    )
      body = [];
    else {
      const match = /^\/api\/sessions\/([^/]+)(.*)$/.exec(url.pathname);
      const session = sessions.find((s) => s.id === match?.[1]);
      if (session) {
        const suffix = match[2];
        if (suffix === '') body = { session, capabilities: [] };
        else if (suffix === '/events/page')
          body = { events: events(session.id), nextBeforeId: null, nextAfterId: null };
        else if (suffix === '/events/turns')
          body = events(session.id)
            .filter((e) => e.data.role === 'user')
            .map((e) => ({ eventId: e.id, prompt: e.data.content, timestamp }));
        else if (suffix === '/execution')
          body = { connection: 'connected', execution: 'idle', queue: [], attention: 'none' };
        else if (suffix === '/review' || suffix === '/repository/review') body = { files: [] };
        else if (suffix === '/git/status')
          body = {
            isRepo: false,
            branch: null,
            hasPrimaryRemote: false,
            remoteName: null,
            remoteProvider: null,
            upstreamBranch: null,
            hasUpstream: false,
            aheadCount: 0,
            behindCount: 0,
            pr: null,
          };
        else if (suffix === '/branches' || suffix === '/agents') body = [];
      }
    }
    if (body === undefined) {
      failures.push(`Missing fixture: ${url.pathname}`);
      response.writeHead(404).end();
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    row.finishedAt = performance.now();
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
    return true;
  }
  return { handle, requests, failures, delayMs };
}

export async function runJourneys({ send, evaluate, origin, api, errors }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (expression) => {
    const deadline = Date.now() + 20000;
    while (!(await evaluate(`Boolean(${expression})`))) {
      if (errors.length || api.failures.length)
        throw new Error([...errors, ...api.failures].join('\n'));
      if (Date.now() > deadline)
        throw new Error(
          `Journey timed out: ${expression}\n${JSON.stringify(await evaluate('({url:location.href,text:document.body.innerText.slice(-4000), metrics:window.agentctlPerformance?.snapshot()})'))}\nRequests: ${api.requests.map((r) => r.path).join(', ')}`,
        );
      await sleep(25);
    }
  };
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
    window.__journeyLongTasks = [];
    new PerformanceObserver(list => window.__journeyLongTasks.push(...list.getEntries().map(e => ({ startTime: e.startTime, duration: e.duration })))).observe({type:'longtask', buffered:true});
  `,
  });
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const samples = [];
  for (let sample = 0; sample < 4; sample++) {
    const requestStart = api.requests.length;
    await send('Page.navigate', { url: `${origin}/sessions/${journeyIds[0]}?perf=1` });
    await waitFor(
      `window.agentctlPerformance?.snapshot().some(s => s.name === 'launch-to-typeable') && document.querySelector('textarea:not(:disabled)') && document.body.textContent.includes('Journey 0 answer 199')`,
    );
    const startup = await evaluate(
      `({samples:window.agentctlPerformance.snapshot(), resources:performance.getEntriesByType('resource').filter(e => /\\.(js|css)$/.test(new URL(e.name).pathname)).map(e => ({name:new URL(e.name).pathname, bytes:e.decodedBodySize, duration:e.duration})), longTasks:window.__journeyLongTasks})`,
    );
    startup.moduleBytes = startup.resources
      .filter((r) => r.name.endsWith('.js'))
      .reduce((sum, r) => sum + r.bytes, 0);
    startup.eagerDeferredAssets = startup.resources
      .filter((r) =>
        /settings-ui|SettingsDialog|SetupWizard|ProviderAuthDialog|vendor-terminal/.test(r.name),
      )
      .map((r) => r.name);
    if (process.argv.includes('--verify-deferred') && startup.eagerDeferredAssets.length)
      throw new Error(
        `Deferred UI downloaded during startup: ${startup.eagerDeferredAssets.join(', ')}`,
      );
    const navigation = [];
    for (const [index, intent] of [
      [1, 'click'],
      [2, 'hover'],
      [3, 'focus'],
      [0, 'revisit'],
    ]) {
      const selector = `a[href='/sessions/${journeyIds[index]}']`;
      await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
      const from = api.requests.length;
      if (intent === 'hover')
        await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('mouseover', {bubbles:true}))`,
        );
      if (intent === 'focus')
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      if (intent === 'hover' || intent === 'focus') await sleep(250);
      const beforeClick = api.requests.length;
      if (
        process.argv.includes('--verify-deferred') &&
        (intent === 'hover' || intent === 'focus')
      ) {
        const prefetched = api.requests.slice(from, beforeClick).map((r) => r.path);
        if (
          !prefetched.includes(`/api/sessions/${journeyIds[index]}`) ||
          !prefetched.includes(`/api/sessions/${journeyIds[index]}/events/page`)
        )
          throw new Error(`${intent} did not prefetch session detail and history`);
      }
      const oldCount = await evaluate(
        `window.agentctlPerformance.snapshot().filter(s => s.name === 'session-click-to-feed-painted').length`,
      );
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await waitFor(
        `window.agentctlPerformance.snapshot().filter(s => s.name === 'session-click-to-feed-painted').length > ${oldCount} && document.body.textContent.includes('Journey ${index} answer 199') && document.querySelector('textarea:not(:disabled)')`,
      );
      const durationMs = await evaluate(
        `window.agentctlPerformance.snapshot().filter(s => s.name === 'session-click-to-feed-painted').at(-1).durationMs`,
      );
      navigation.push({
        intent,
        durationMs,
        requestsBeforeClick: api.requests.slice(from, beforeClick).map((r) => r.path),
        requests: api.requests.slice(from).map((r) => ({
          ...r,
          startedAt: r.startedAt - api.requests[from].startedAt,
          finishedAt: r.finishedAt === null ? null : r.finishedAt - api.requests[from].startedAt,
        })),
      });
    }
    // Exercise the delayed settings chunk without changing server state.
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key:',', code:'Comma', ctrlKey:true, bubbles:true}))`,
    );
    await waitFor(
      `!!document.querySelector('[role=dialog]') && document.body.textContent.includes('Preferences & Integrations')`,
    );
    await evaluate(`document.querySelector('[aria-label="Close settings"]').click()`);
    await waitFor(
      `!document.querySelector('[role=dialog]') && document.body.style.pointerEvents !== 'none'`,
    );
    await sleep(250); // Let the closing overlay animation finish before the screenshot.
    if (sample > 0)
      samples.push({
        repetition: sample,
        startup,
        navigation,
        apiRequests: api.requests.slice(requestStart).length,
      });
    console.log(
      `${sample === 0 ? 'Warmup' : `Sample ${sample}`} startup ${startup.samples.find((s) => s.name === 'launch-to-typeable').durationMs.toFixed(1)} ms; navigation ${navigation.map((n) => `${n.intent} ${n.durationMs.toFixed(1)}`).join(', ')} ms`,
    );
    if (sample < 3) await send('Page.navigate', { url: 'about:blank' });
  }
  if (errors.length || api.failures.length)
    throw new Error([...errors, ...api.failures].join('\n'));
  return {
    schemaVersion: 1,
    fixtureVersion: JOURNEY_FIXTURE_VERSION,
    generatedAt: new Date().toISOString(),
    environment: {
      scope:
        'Production web app, synthetic GET APIs and idle SSE, 200 text events per session; one discarded warmup and three page reloads with HTTP cache disabled; remote fonts blocked, system font fallback. No agent, real server, or native startup.',
      apiDelayMs: api.delayMs,
    },
    scenarios: samples,
    cpu: [],
  };
}
