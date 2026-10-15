import Fastify from 'fastify';
import { validatorCompiler } from '@fastify/type-provider-zod';
import http from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import { sessionEventSnapshotSchema, type SessionEventRow } from '@agentctl/shared';
import { eventsRoutes } from './events.js';
import { EventBus } from '../utils/event-bus.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof createDatabase>;
let bus: EventBus;
const requests: http.ClientRequest[] = [];
beforeEach(async () => {
  app = Fastify();
  db = createDatabase(':memory:');
  bus = new EventBus();
  app.decorate('db', db);
  app.decorate('eventBus', bus);
  app.decorate('sessionManager', {
    getOrResuscitate: async () => ({ getLiveEventSnapshots: () => [] }),
  });
  app.setValidatorCompiler(validatorCompiler);
  await app.register(eventsRoutes, { prefix: '/api' });
  db.insert(projects).values({ id: 'project', name: 'Project', path: '/tmp/project' }).run();
  db.insert(sessions)
    .values({
      id: sessionId,
      projectId: 'project',
      branch: 'main',
      worktreePath: '/tmp/project',
      taskSlug: 'task',
      baseCommit: 'none',
      agent: 'agent',
      selectedProvider: 'agent',
    })
    .run();
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterEach(async () => {
  for (const request of requests.splice(0)) request.destroy();
  await app.close();
  vi.restoreAllMocks();
});
function seed(count: number, content = 'message') {
  for (let id = 1; id <= count; id++)
    db.insert(sessionEvents)
      .values({
        id,
        sessionId,
        type: 'text',
        data: JSON.stringify({ role: 'provider', content: `${id}: ${content}` }),
      })
      .run();
}
function readStream(query: string, until: (body: string) => boolean): Promise<string> {
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No listening port');
  return new Promise((resolve, reject) => {
    let body = '';
    const request = http.get(
      `http://127.0.0.1:${address.port}/api/sessions/${sessionId}/events/stream?${query}`,
      (response) => {
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.endsWith('\n\n') && until(body)) {
            request.destroy();
            resolve(body);
          }
        });
        response.on('end', () =>
          until(body) ? resolve(body) : reject(new Error(`Stream ended: ${body.slice(0, 200)}`)),
        );
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    requests.push(request);
  });
}

it('replaces a large catch-up with a chronological snapshot and a usable history cursor', async () => {
  seed(250);
  const body = await readStream('snapshots=true&lastEventId=1', (body) =>
    body.includes('event: session_snapshot'),
  );
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  const snapshot = sessionEventSnapshotSchema.parse(JSON.parse(data!.slice(6)));
  expect(snapshot.highWaterId).toBe(250);
  expect(snapshot.events.map((event) => event.id)).toEqual(
    Array.from({ length: 200 }, (_, index) => index + 51),
  );
  expect(snapshot.nextBeforeId).toBe(51);
  expect(body).not.toContain('event: session_event');
  const older = await app.inject(`/api/sessions/${sessionId}/events/page?beforeId=51`);
  expect(older.json().events.map((event: SessionEventRow) => event.id)).toEqual(
    Array.from({ length: 50 }, (_, index) => index + 1),
  );
});

it('streams notices without history rows, SSE IDs or replay on reconnection', async () => {
  const notice = {
    type: 'notice' as const,
    sessionId,
    severity: 'error',
    title: 'Optional integration unavailable',
  };
  const state = vi.fn();
  const unsubscribeState = bus.subscribeState(state);
  const subscribe = bus.subscribe.bind(bus);
  const spy = vi.spyOn(bus, 'subscribe').mockImplementation((id, listener) => {
    const release = subscribe(id, listener);
    queueMicrotask(() => bus.publish(notice));
    return release;
  });
  try {
    const body = await readStream('lastEventId=0', (value) =>
      value.includes('event: session_notice'),
    );
    expect(body).toContain(`event: session_notice\ndata: ${JSON.stringify(notice)}\n\n`);
    expect(body).not.toContain('id: ');
    expect(state).not.toHaveBeenCalled();
    expect(db.select().from(sessionEvents).all()).toEqual([]);
    spy.mockRestore();
    seed(1);
    const replay = await readStream('lastEventId=0', (value) =>
      value.includes('event: session_event'),
    );
    expect(replay).not.toContain('session_notice');
    expect(replay).not.toContain(notice.title);
  } finally {
    spy.mockRestore();
    unsubscribeState();
  }
});

it('uses snapshots for a byte-heavy gap and a cursor ahead of the database', async () => {
  seed(3, 'x'.repeat(400_000));
  for (const lastEventId of [0, 999]) {
    const body = await readStream(`snapshots=true&lastEventId=${lastEventId}`, (body) =>
      body.includes('event: session_snapshot'),
    );
    const data = body.split('\n').find((line) => line.startsWith('data: '));
    const snapshot = sessionEventSnapshotSchema.parse(JSON.parse(data!.slice(6)));
    expect(snapshot.events.map((event) => event.id)).toEqual([2, 3]);
    expect(snapshot.highWaterId).toBe(3);
    expect(snapshot.nextBeforeId).toBe(2);
  }
});

it('delivers live updates received during catch-up and retains legacy replay', async () => {
  seed(2);
  const live: SessionEventRow = {
    id: 3,
    sessionId,
    type: 'text',
    data: { role: 'provider', content: 'Arrived during catch-up' },
    createdAt: new Date(),
  };
  const subscribe = bus.subscribe.bind(bus);
  vi.spyOn(bus, 'subscribe').mockImplementation((id, callback) => {
    const unsubscribe = subscribe(id, callback);
    // This runs after subscription, while the route is awaiting its database query.
    queueMicrotask(() => bus.publish(live));
    return unsubscribe;
  });
  for (const query of ['snapshots=true&lastEventId=1', 'lastEventId=1']) {
    const body = await readStream(query, (body) => body.includes('Arrived during catch-up'));
    expect(body).toContain('id: 2\nevent: session_event');
    expect(body).toContain('id: 3\nevent: session_event');
    expect(body).not.toContain('event: session_snapshot');
  }
});
