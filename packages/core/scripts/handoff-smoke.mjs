import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { AcpAgentDriver } from '../dist/acp/driver.js';
import { AcpV1AgentDriver } from '../dist/acp/v1/driver.js';
import { AcpV2AgentDriver } from '../dist/acp/v2/driver.js';
import { PersistentAgentConnectionManager } from '../dist/acp/transport/persistent-connection.js';
import {
  ownAcpProcess,
  terminateChildProcess,
} from '../dist/acp/transport/acp-process-lifecycle.js';
import {
  createDatabase,
  projects,
  sessions,
  providers,
  sessionEvents,
  sessionProviderContexts,
} from '../dist/db/index.js';
import { Provider } from '../dist/providers/provider.js';
import { SessionManager } from '../dist/session/manager.js';
import { noopLogger } from '../dist/logger.js';
import { redactSensitiveText } from '../dist/session/handoff.js';

const { values } = parseArgs({
  options: { config: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(
    'AGENTCTL_HANDOFF_SMOKE=1 node scripts/handoff-smoke.mjs --config /absolute/providers.json --output /absolute/report.json',
  );
  process.exit(0);
}
if (process.env.AGENTCTL_HANDOFF_SMOKE !== '1' || !values.config)
  throw new Error('Real-provider handoff checks require AGENTCTL_HANDOFF_SMOKE=1 and --config.');
const config = z
  .object({
    providers: z
      .array(
        z.object({
          id: z.string().min(1),
          command: z.string().min(1),
          args: z.array(z.string()).default([]),
          model: z.string().min(1),
          env: z.record(z.string(), z.string()).default({}),
          protocol: z.enum(['v1', 'v2', 'auto']).default('v1'),
        }),
      )
      .length(2),
    timeoutMs: z.number().int().positive().max(300_000).default(120_000),
  })
  .parse(JSON.parse(await fs.readFile(values.config, 'utf8')));
assert.notEqual(config.providers[0].id, config.providers[1].id);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-handoff-live-'));
const workspace = path.join(directory, 'project');
await fs.mkdir(workspace);
const originalHome = process.env.AGENTCTL_HOME;
process.env.AGENTCTL_HOME = path.join(directory, 'state');
process.env.AGENTCTL_SKILLS_DIR = path.join(directory, 'state', 'skills');
process.env.AGENTCTL_WORKSPACE_SKILLS_DIR = path.join(directory, 'workspace-skills');
process.env.AGENTCTL_SKILL_PATH = '';
const dbPath = path.join(directory, 'state.sqlite');
const db = createDatabase(dbPath);
const children = new Set();
const spawnTracked = (...args) => {
  const child = ownAcpProcess(spawn(...args));
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
};
const cache = new Map();
const driver = new AcpAgentDriver(
  new AcpV1AgentDriver(spawnTracked, noopLogger, undefined, {
    get: async (key) => cache.get(key) ?? null,
    set: async (key, value) => {
      cache.set(key, value);
    },
    delete: async (key) => {
      cache.delete(key);
    },
  }),
  new AcpV2AgentDriver(spawnTracked),
);
const calls = [];
const start = driver.startSession.bind(driver);
driver.startSession = async (...args) => {
  const session = await start(...args);
  const options = args[2];
  calls.push({
    providerId: options.providerId,
    intent: options.intent,
    nativeSessionId: session.id,
    history: session.history,
  });
  return session;
};
const report = {
  directory,
  status: 'running',
  providers: config.providers.map(({ id, model, protocol }) => ({ id, model, protocol })),
  checks: [],
  calls,
};
let manager;
let pool;
let liveSessionId;
async function check(name, work) {
  console.log(`Checking ${name}...`);
  let timer;
  try {
    const result = await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out`)), config.timeoutMs);
      }),
    ]);
    report.checks.push({ name, passed: true });
    return result;
  } catch (error) {
    report.checks.push({
      name,
      passed: false,
      error: redactSensitiveText(String(error.message ?? error)),
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
const profileMap = new Map(config.providers.map((p) => [p.id, p]));
const rows = () => db.select().from(providers).all();
const provider = (id) => new Provider(rows().find((row) => row.id === id));
try {
  for (const profile of config.providers) {
    const descriptor = await check(`inspect:${profile.id}`, () =>
      driver.inspectProvider(profile.command, profile.args, {
        ...profile.env,
        AGENTCTL_ACP_PROTOCOL: profile.protocol,
      }),
    );
    assert.notEqual(descriptor.status, 'needs_auth', `${profile.id} needs authentication`);
    db.insert(providers)
      .values({
        id: profile.id,
        name: profile.id,
        command: profile.command,
        launchArgs: JSON.stringify(profile.args),
        launchEnv: JSON.stringify(profile.env),
        protocol: profile.protocol,
        installState: 'system_available',
        authState: 'authenticated',
        features: JSON.stringify(descriptor.features ?? {}),
        configOptions: JSON.stringify(descriptor.configOptions),
        authMethods: JSON.stringify(descriptor.authMethods),
        supportsDynamicModel: descriptor.supportsDynamicModel,
        supportsDynamicConfig: descriptor.supportsDynamicConfig,
      })
      .run();
  }
  pool = new PersistentAgentConnectionManager(
    { get: (id) => rows().find((row) => row.id === id), listAll: rows },
    { getSnapshot: () => undefined },
    {
      resolveLaunch: (row) => {
        const p = profileMap.get(row.id);
        return {
          command: p.command,
          args: p.args,
          env: { ...p.env, AGENTCTL_ACP_PROTOCOL: p.protocol },
        };
      },
      prepareLaunch: async (_id, launch) => launch,
    },
    noopLogger,
  );
  const registry = {
    getConnectionManager: () => pool,
    ensureProviderReady: async (id) => provider(id),
    discover: async () => rows().map((row) => new Provider(row).toDiscovery()),
    getSettings: async () => ({ defaultProviderId: config.providers[0].id }),
  };
  const eventBus = {
    publish(event) {
      if (event?.type !== 'approval_request' || !event.data?.requiresApproval) return;
      const call = event.data.request?.toolCall;
      const input = call?.arguments ?? call?.rawInput ?? {};
      const requested =
        call?.locations?.map((location) => location.path).filter(Boolean) ??
        [input.path ?? input.filePath].filter(Boolean);
      const allowed =
        call?.kind === 'read' &&
        requested.length > 0 &&
        requested.every((file) => {
          const relative = path.relative(directory, path.resolve(file));
          return (
            relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
          );
        });
      setImmediate(() =>
        manager?.getSession(event.sessionId)?.resolvePermission(String(event.id), { allowed }),
      );
    },
  };
  manager = new SessionManager(db, undefined, registry, eventBus, noopLogger, driver);
  const projectId = randomUUID(),
    sessionId = randomUUID();
  liveSessionId = sessionId;
  db.insert(projects)
    .values({ id: projectId, name: 'Handoff live verification', path: workspace })
    .run();
  const [a, b] = config.providers;
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId,
      branch: 'main',
      worktreePath: workspace,
      baseCommit: 'none',
      taskSlug: 'handoff-live',
      title: 'Handoff live verification',
      agent: a.id,
      selectedProvider: a.id,
      selectedModel: a.model,
      mode: 'local',
      approvalMode: 'review',
    })
    .run();
  const textRows = () =>
    db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)).all();
  const send = async (text) => {
    const eventId = await manager.startInput(sessionId, text);
    await manager.waitForSessionOperations(sessionId);
    const state = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (state.status === 'error') {
      const failure = textRows()
        .filter((event) => event.type === 'status')
        .map((event) => JSON.parse(event.data))
        .findLast((data) => data.error);
      throw new Error(failure?.error?.details ?? failure?.error?.message ?? 'Provider turn failed');
    }
    const answer = textRows()
      .filter((event) => event.parentEventId === eventId && event.type === 'text')
      .map((event) => JSON.parse(event.data))
      .filter((data) => data.role === 'provider')
      .map((data) => data.content ?? data.text ?? '')
      .join('');
    assert.ok(answer.trim(), 'Provider returned no answer');
    return answer;
  };
  const alpha = `violet-${randomUUID().slice(0, 8)}`;
  const beta = `copper-${randomUUID().slice(0, 8)}`;
  await check('first-provider', async () => {
    assert.ok(
      (
        await send(
          `Remember the project marker ${alpha}. Reply with only that marker. Do not call tools or write files.`,
        )
      ).includes(alpha),
    );
  });
  const aNative = manager.getSession(sessionId).nativeSessionId;
  await check('switch-A-to-B', () =>
    manager.updateSessionConfig(sessionId, { selectedProvider: b.id, selectedModel: b.model }),
  );
  await check('B-recalls-A', async () => {
    const answer = await send(
      `What is the project marker I gave the previous provider? Also remember the release marker ${beta}. Reply with both markers only. Do not call tools or write files.`,
    );
    assert.ok(answer.includes(alpha), 'B lost A history');
    assert.ok(answer.includes(beta));
  });
  await check('switch-B-to-A', () =>
    manager.updateSessionConfig(sessionId, { selectedProvider: a.id, selectedModel: a.model }),
  );
  await check('A-resumes-native-conversation', async () => {
    assert.equal(manager.getSession(sessionId).nativeSessionId, aNative);
    assert.equal(calls.at(-1).history, 'restored');
  });
  await check('A-recalls-B', async () => {
    const answer = await send(
      'Reply with the project marker and release marker from this chat. Do not call tools or write files.',
    );
    assert.ok(answer.includes(alpha), 'A lost its original history');
    assert.ok(answer.includes(beta), 'A did not receive B delta');
  });
  await check('reconnect-and-recall', async () => {
    await manager.stopAll();
    pool.closeAll();
    manager = new SessionManager(db, undefined, registry, eventBus, noopLogger, driver);
    await manager.reconnectSession(sessionId);
    assert.equal(manager.getSession(sessionId).nativeSessionId, aNative);
    const answer = await send(
      'Repeat the two markers from this chat. Do not call tools or write files.',
    );
    assert.ok(answer.includes(alpha) && answer.includes(beta));
  });
  await check('one-app-chat-and-recorded-switches', async () => {
    assert.equal(db.select().from(sessions).all().length, 1);
    assert.equal(
      textRows().filter(
        (event) => event.type === 'status' && JSON.parse(event.data).status === 'provider_switched',
      ).length,
      2,
    );
    assert.ok(
      db
        .select()
        .from(sessionProviderContexts)
        .all()
        .every((row) => row.status === 'delivered'),
    );
  });
  const archiveKey = `archive-${randomUUID()}`;
  await manager.getEventRepository().append(sessionId, 'text', {
    role: 'user',
    content: `Archived test note. HISTORICAL_KEY=${archiveKey}\n${'Archived context that must stay intact.\n'.repeat(1800)}`,
  });
  await check('switch-for-omitted-history-retrieval', () =>
    manager.updateSessionConfig(sessionId, { selectedProvider: b.id, selectedModel: b.model }),
  );
  await check('real-provider-reads-omitted-history', async () => {
    const answer = await send(
      'Find HISTORICAL_KEY in the archived test note. It was too large to embed. Read the full persisted transcript linked in the handoff context using your file-read tool. Reply only with that key. Do not write files or execute commands.',
    );
    assert.ok(answer.includes(archiveKey), 'Provider did not recover the key from omitted history');
    const root = path.join(process.env.AGENTCTL_HOME, 'context', sessionId);
    assert.ok((await fs.readdir(root)).length > 0, 'No durable context was saved');
  });
  await check('deleting-chat-removes-saved-context', async () => {
    const root = path.join(process.env.AGENTCTL_HOME, 'context', sessionId);
    await manager.deleteSession(sessionId);
    await assert.rejects(fs.stat(root));
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = redactSensitiveText(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  if (
    manager &&
    liveSessionId &&
    db.select().from(sessions).where(eq(sessions.id, liveSessionId)).get()
  )
    await manager.deleteSession(liveSessionId).catch(() => {});
  await manager?.stopAll().catch(() => {});
  await pool?.dispose().catch(() => {});
  await Promise.all(
    [...children].map((child) =>
      Promise.resolve()
        .then(() => terminateChildProcess(child))
        .catch(() => {}),
    ),
  );
  if (originalHome === undefined) delete process.env.AGENTCTL_HOME;
  else process.env.AGENTCTL_HOME = originalHome;
  report.completedAt = new Date().toISOString();
  if (values.output) {
    await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
    await fs.writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
}
