import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AcpAgentDriver } from '../dist/acp/driver.js';
import { AcpV1AgentDriver } from '../dist/acp/v1/driver.js';
import { AcpV2AgentDriver } from '../dist/acp/v2/driver.js';
import { PersistentAgentConnectionManager } from '../dist/acp/transport/persistent-connection.js';
import { noopLogger } from '../dist/logger.js';
import {
  ownAcpProcess,
  terminateChildProcess,
} from '../dist/acp/transport/acp-process-lifecycle.js';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { config: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(
    'Build core, then run: AGENTCTL_ACP_SMOKE=1 pnpm --filter @agentctl/core acp:smoke --config /absolute/providers.json',
  );
  process.exit(0);
}
if (process.env.AGENTCTL_ACP_SMOKE !== '1' || !values.config)
  throw new Error(
    'Live provider smoke tests require AGENTCTL_ACP_SMOKE=1 and --config. Use --help for usage.',
  );

const profileSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  protocol: z.enum(['v1', 'v2', 'auto']).default('v1'),
  timeoutMs: z.number().int().positive().max(300_000).default(60_000),
  authMethodId: z.string().optional(),
});
const profiles = z
  .object({ providers: z.array(profileSchema).min(1).max(16) })
  .parse(JSON.parse(await fs.readFile(values.config, 'utf8'))).providers;
const reports = [];

for (const profile of profiles) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-acp-smoke-'));
  const launch = {
    command: profile.command,
    args: profile.args,
    env: { ...profile.env, AGENTCTL_ACP_PROTOCOL: profile.protocol },
  };
  const cache = new Map();
  const children = new Set();
  const spawnTracked = (command, args, options) => {
    const child = ownAcpProcess(spawn(command, args, options));
    children.add(child);
    child.once('close', () => children.delete(child));
    return child;
  };
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
  // Use the production pool, with explicit launch metadata instead of app/database discovery.
  const row = { id: profile.id, command: profile.command, registryAgentId: profile.id };
  const store = { get: (id) => (id === profile.id ? row : undefined), listAll: () => [row] };
  const snapshot = {
    version: 'smoke',
    agents: [
      {
        id: profile.id,
        name: profile.id,
        version: '1.0.0',
        description: 'Explicit smoke profile',
        authors: [],
        distribution: { npx: { package: 'smoke-profile' } },
      },
    ],
  };
  const connections = new PersistentAgentConnectionManager(
    store,
    { getSnapshot: () => ({ data: JSON.stringify(snapshot) }) },
    { resolveLaunch: () => launch },
    noopLogger,
  );
  driver.setConnectionManager(connections);
  const report = {
    providerId: profile.id,
    protocol: profile.protocol,
    status: 'running',
    operations: [],
  };
  const handles = new Set();
  const startedAt = performance.now();
  let activeOperation = 'initialize';
  const prompt = 'Respond with exactly "ACP smoke passed". Do not invoke tools or change files.';
  let observe = () => {};
  const callbacks = {
    onUpdate: (event) => observe(event),
    onRequestPermission: async () => ({ allowed: false }),
    onRequestElicitation: async () => ({ action: 'cancel' }),
  };
  const deadline = async (work, label) => {
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out`)), profile.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const check = async (name, work) => {
    activeOperation = name;
    const start = performance.now();
    const result = await deadline(work(), name);
    report.operations.push({ name, durationMs: performance.now() - start });
    return result;
  };
  const startSession = async (intent, features) => {
    const session = await driver.startSession(
      launch.command,
      launch.args,
      { providerId: profile.id, cwd: directory, env: launch.env, features, intent },
      callbacks,
    );
    handles.add(session);
    return session;
  };
  try {
    let descriptor = await check('initialize', () =>
      driver.inspectProvider(launch.command, launch.args, launch.env),
    );
    if (profile.authMethodId) {
      await check('authenticate', () =>
        driver.authenticateProvider(launch.command, launch.args, launch.env, profile.authMethodId),
      );
      descriptor = await check('verify_auth', () =>
        driver.inspectProvider(launch.command, launch.args, launch.env),
      );
    }
    if (descriptor.status === 'needs_auth') throw new Error('Provider requires authentication');
    const session = await check('new', () => startSession({ kind: 'new' }, descriptor.features));
    const result = await check('prompt', () => session.prompt(prompt));
    if (result.stopReason === 'error') throw new Error('Provider failed foreground work');
    const config =
      session.configOptions?.find((option) => option.type === 'boolean') ??
      session.configOptions?.[0];
    if (config)
      await check('config', () =>
        session.updateConfigOption(
          config.id,
          typeof config.currentValue === 'boolean' ? !config.currentValue : config.currentValue,
        ),
      );
    if (descriptor.features?.sessions.list)
      await check('list', () => session.listSessions({ cwd: directory }));
    // Wait for progress so cancellation is not sent before the prompt request reaches the peer.
    const progress = Promise.withResolvers();
    observe = (event) => {
      if (['text', 'thought', 'user_message_accepted'].includes(event.type)) progress.resolve();
    };
    await check('cancel', async () => {
      const work = session.prompt(prompt);
      const first = await Promise.race([
        progress.promise.then(() => 'progress'),
        work.then(() => 'complete'),
      ]);
      if (first === 'progress') await session.cancel();
      await work;
    });
    observe = () => {};
    if (descriptor.features?.sessions.fork) {
      const fork = await check('fork', () =>
        startSession({ kind: 'fork', sessionId: session.id }, descriptor.features),
      );
      if (fork.history !== 'restored' || fork.id === session.id)
        throw new Error('Provider fork did not restore independent history');
      await check('close_fork', () => fork.close());
      handles.delete(fork);
      if (descriptor.features.sessions.delete)
        await check('delete_fork', () => session.deleteSession(fork.id));
    }
    const id = session.id;
    await check('close', () => session.close());
    handles.delete(session);
    if (descriptor.features?.sessions.resume) {
      const resumed = await check('resume', () =>
        startSession({ kind: 'resume', sessionId: id, requireExisting: true }, descriptor.features),
      );
      if (resumed.history !== 'restored') throw new Error('Native resume did not restore history');
      await check('close_resume', () => resumed.close());
      handles.delete(resumed);
    }
    if (descriptor.features?.sessions.delete)
      await check('delete', () =>
        driver.deleteSession(launch.command, launch.args, launch.env, id),
      );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    // Keep credentials, prompts, paths, protocol payloads and provider stderr out of reports.
    report.failedOperation = activeOperation;
    report.failureKind = error instanceof Error ? error.name : 'Error';
  } finally {
    observe = () => {};
    await Promise.allSettled([...handles].map((handle) => handle.close()));
    connections.closeAll();
    for (const child of children) terminateChildProcess(child, noopLogger, 0, 'SIGKILL');
    await fs.rm(directory, { recursive: true, force: true });
  }
  report.durationMs = performance.now() - startedAt;
  reports.push(report);
}
console.log(JSON.stringify({ sdkVersion: '1.8.0', providers: reports }, null, 2));
if (reports.some((report) => report.status !== 'passed')) process.exitCode = 1;
