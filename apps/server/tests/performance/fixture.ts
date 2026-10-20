import { openEventStream } from './event-stream.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay, setImmediate as yieldLoop } from 'node:timers/promises';
import assert from 'node:assert/strict';
import {
  createDatabase,
  projects,
  sessions,
  sessionOperations,
  sessionEvents,
} from '@agentctl/core/db';
import { ProviderRegistry } from '@agentctl/core/providers';
import { createAgentRuntimeServices, noopLogger } from '@agentctl/core';
import type { SessionManager } from '@agentctl/core/session';
import { parseServerEnv } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../src/app.js';
import type { SessionRuntime as Runtime } from '../../../../packages/core/src/session/runtime/session-runtime.js';
import type {
  SessionOperationWorker as OperationWorker,
  PendingSessionMessage,
} from '../../../../packages/core/src/session/execution/session-operation-worker.js';
import { SessionEventRepository } from '@agentctl/core/session';
import type { AgentSession, AgentPromptResult } from '../../../../packages/core/src/agent/types.js';

// The benchmark runs built JS without a TS loader. Resolve private test fixtures beside the
// public core entry so source and emitted server tests both exercise the same built runtime.
const { SessionRuntime } = (await import(
  new URL('./session/runtime/session-runtime.js', import.meta.resolve('@agentctl/core')).href
)) as typeof import('../../../../packages/core/src/session/runtime/session-runtime.js');
const { SessionOperationWorker } = (await import(
  new URL('./session/execution/session-operation-worker.js', import.meta.resolve('@agentctl/core'))
    .href
)) as typeof import('../../../../packages/core/src/session/execution/session-operation-worker.js');

export type SyntheticPrompt = (runtime: Runtime, text: string) => Promise<AgentPromptResult>;

/** Test-only composition: actual app, queue, runtime and database; no catalog/network/provider process. */
export async function createBackendFixture(options: {
  sessions: number;
  database?: string;
  seed?: boolean;
  prompt?: SyntheticPrompt;
  cancel?: (id: string) => Promise<void>;
}) {
  const db = createDatabase(options.database ?? ':memory:');
  const ids = Array.from(
    { length: options.sessions },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  if (options.seed !== false) {
    db.insert(projects)
      .values({ id: 'performance', name: 'Synthetic performance fixture', path: '/synthetic' })
      .run();
    for (const id of ids)
      db.insert(sessions)
        .values({
          id,
          projectId: 'performance',
          branch: 'main',
          worktreePath: '/synthetic',
          taskSlug: id,
          baseCommit: 'none',
          agent: 'synthetic',
          selectedProvider: 'synthetic',
        })
        .run();
  }
  const runtimeServices = createAgentRuntimeServices({ db, logger: noopLogger });
  const providers = new ProviderRegistry(db, undefined, undefined, runtimeServices);
  providers.sync = async () => {};
  providers.autoUpdateInstalledProviders = async () => {};
  providers.probeAllInstalledProviders = async () => {};
  providers.recoverInterruptedOperations = async () => {};
  const runtimes = new Map<string, Runtime>();
  let worker: OperationWorker;
  const manager = {
    startInput: (id: string, text: string, attachments: string[], command: string) =>
      worker.acceptMessage(id, text, attachments, command),
    getOrResuscitate: async (id: string) => runtimes.get(id),
    recoverInterruptedOperations: async () => {},
    stopAll: async () => {
      worker.stop();
      await Promise.all([...runtimes.values()].map((runtime) => runtime.stop()));
      await worker.idleAll();
    },
  };
  const app = await buildApp({
    db,
    providerRegistry: providers,
    runtimeServices,
    sessionManager: manager as unknown as SessionManager,
    env: parseServerEnv({
      NODE_ENV: 'test',
      PORT: '0',
      AGENTCTL_SESSION_KEY: 'performance-session-key-01234567890123456789',
      AGENTCTL_SESSION_SALT: 'performance-salt',
    }),
  });
  // No gateway listener or external tools belong in the synthetic workload.
  app.mcpGateway.start = async () => {};
  const events = new SessionEventRepository(db, app.eventBus);
  const defaultPrompt: SyntheticPrompt = async (runtime) => {
    await delay(2);
    for (let chunk = 0; chunk < 20; chunk++) {
      await runtime.handleDomainEvent({ type: 'text', text: 'synthetic output ' });
      if (chunk % 4 === 0) await yieldLoop();
    }
    return { stopReason: 'end_turn' };
  };
  for (const id of ids) {
    let runtime: Runtime;
    const handle: AgentSession = {
      id: `synthetic-${id}`,
      history: 'fresh',
      closed: new Promise(() => {}),
      onError() {},
      onClose() {},
      authenticate: async () => {},
      cancel: async () => options.cancel?.(id),
      close: async () => {},
      prompt: (text) => (options.prompt ?? defaultPrompt)(runtime, text),
    };
    runtime = new SessionRuntime(id, handle, db, events, '/synthetic', undefined, app.log);
    runtimes.set(id, runtime);
  }
  const dispatches: Array<{ sessionId: string; command: string; started: number; ended?: number }> =
    [];
  const active = new Map<string, number>();
  let maxActive = 0;
  worker = new SessionOperationWorker(
    db,
    events,
    async (id, message: PendingSessionMessage) => {
      assert.equal(active.get(id) ?? 0, 0, 'A session dispatched overlapping turns');
      active.set(id, 1);
      maxActive = Math.max(
        maxActive,
        [...active.values()].reduce((sum, value) => sum + value, 0),
      );
      const dispatch = {
        sessionId: id,
        command: message.text,
        started: performance.now(),
        ended: undefined as number | undefined,
      };
      dispatches.push(dispatch);
      try {
        await runtimes
          .get(id)!
          .prompt(message.text, message.attachmentIds, undefined, undefined, undefined, undefined, {
            eventId: message.eventId,
            attemptId: message.attemptId,
          });
      } finally {
        dispatch.ended = performance.now();
        active.delete(id);
      }
    },
    app.log,
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const streams = new Set<Awaited<ReturnType<typeof openEventStream>>>();
  return {
    app,
    db,
    ids,
    worker,
    events,
    runtimes,
    dispatches,
    url,
    get maxActive() {
      return maxActive;
    },
    operations: () => db.select().from(sessionOperations).all(),
    pause: () => db.update(sessions).set({ status: 'error' }).run(),
    resume: async () => {
      for (const id of ids) await worker.resumeQueue(id);
    },
    send: async (id: string, text: string, command: string = randomUUID()) => {
      const response = await fetch(`${url}/api/sessions/${id}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text, clientMessageId: command }),
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    },
    stream: async (id: string, lastId?: number) => {
      const stream = await openEventStream(`${url}/api/sessions/${id}/events/stream`, lastId);
      streams.add(stream);
      return stream;
    },
    setIdle: () =>
      db
        .update(sessions)
        .set({ status: 'idle' })
        .where(eq(sessions.projectId, 'performance'))
        .run(),
    close: async () => {
      for (const stream of streams) stream.close();
      app.server.closeAllConnections();
      await app.close();
    },
  };
}

export async function waitUntil(check: () => boolean, message = 'condition', timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    assert(performance.now() < deadline, `Timed out waiting for ${message}`);
    await delay(5);
  }
}

/** Seed outside measurement; pages retain a cursor even after repeated batches. */
export function seedHistory(
  context: Awaited<ReturnType<typeof createBackendFixture>>,
  count: number,
) {
  context.db.transaction((tx) => {
    for (const id of context.ids)
      for (let start = 0; start < count; start += 100) {
        tx.insert(sessionEvents)
          .values(
            Array.from({ length: Math.min(100, count - start) }, (_, offset) => ({
              sessionId: id,
              type: 'text' as const,
              data: JSON.stringify({
                role: (start + offset) % 2 ? 'provider' : 'user',
                content: 'Synthetic history '.repeat(16),
              }),
            })),
          )
          .run();
      }
  });
}
