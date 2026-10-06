import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions, sessionEvents } from '@agentctl/core/db';
import { ElicitationRegistry, type SessionManager } from '@agentctl/core/session';
import { ProviderRegistry } from '@agentctl/core/providers';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import type { SessionEventRow } from '@agentctl/shared';
import http from 'node:http';

describe('SSE stream & Client actions REST API endpoints', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  let activeRequests: http.ClientRequest[] = [];
  const mockSessionManager = {
    handleClientMessage: vi.fn(),
    startInput: vi.fn(),
    getOrResuscitate: vi.fn(),
    getSession: vi.fn(),
    stopAll: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(ProviderRegistry.prototype, 'sync').mockResolvedValue();
    vi.spyOn(ProviderRegistry.prototype, 'autoUpdateInstalledProviders').mockResolvedValue();
    vi.spyOn(ProviderRegistry.prototype, 'recoverInterruptedOperations').mockResolvedValue();
    activeRequests = [];
    db = createDatabase(':memory:');

    const testEnv = parseServerEnv({
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    app = await buildApp({
      db,
      sessionManager: mockSessionManager as unknown as SessionManager,
      env: testEnv,
    });
  });

  afterEach(async () => {
    for (const req of activeRequests) {
      if (!req.destroyed) {
        req.destroy();
      }
    }
    await app.close();
    vi.restoreAllMocks();
  });

  test('elicitation responses preserve the decline action', async () => {
    const respond = vi
      .spyOn(app.sessionService, 'respondToElicitation')
      .mockImplementation(() => {});
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const decline = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/elicitations/form/respond`,
      payload: { action: 'decline' },
    });
    expect(decline.statusCode).toBe(200);
    expect(respond).toHaveBeenCalledWith(sessionId, 'form', {
      action: 'decline',
      values: undefined,
    });
  });

  test('invalid elicitation responses return 400 and a correction can complete the same form', async () => {
    const registry = new ElicitationRegistry();
    const { item, promise } = registry.createElicitation({
      id: 'form',
      mode: 'form',
      message: 'Provide a code',
      form: {
        fields: [
          { id: 'code', label: 'Code', type: 'string', required: true, pattern: '^[A-Z]+$' },
        ],
      },
    });
    mockSessionManager.getSession.mockReturnValue({
      respondToElicitation: registry.respondToElicitation.bind(registry),
    });
    const url = '/api/sessions/11111111-1111-4111-8111-111111111111/elicitations/form/respond';
    const invalid = await app.inject({
      method: 'POST',
      url,
      payload: { action: 'submit', values: { code: 'wrong' } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(item.status).toBe('pending');
    const valid = await app.inject({
      method: 'POST',
      url,
      payload: { action: 'submit', values: { code: 'VALID' } },
    });
    expect(valid.statusCode).toBe(200);
    expect(await promise).toMatchObject({ action: 'submit', values: { code: 'VALID' } });
    mockSessionManager.getSession.mockReset();
  });

  test('POST /api/sessions/:id/cancel calls handleClientMessage cancel', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/cancel`,
      headers: {
        authorization: 'Bearer test-secret',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true });
    expect(mockSessionManager.handleClientMessage).toHaveBeenCalledWith(sessionId, 'cancel', {});
  });

  test('POST /api/sessions/:id/approve calls handleClientMessage approve', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/approve`,
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        eventId: 42,
        optionId: 'my-option',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true });
    expect(mockSessionManager.handleClientMessage).toHaveBeenCalledWith(sessionId, 'approve', {
      eventId: 42,
      optionId: 'my-option',
    });
  });

  test('POST /api/sessions/:id/deny calls handleClientMessage deny', async () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/deny`,
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        eventId: 42,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true });
    expect(mockSessionManager.handleClientMessage).toHaveBeenCalledWith(sessionId, 'deny', {
      eventId: 42,
    });
  });

  test('POST /api/sessions/:id/input acknowledges a persisted input event', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444';
    mockSessionManager.startInput.mockResolvedValue(42);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/input`,
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        input: 'hello agent',
        attachmentIds: ['attachment-1'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true, eventId: 42 });
    expect(mockSessionManager.startInput).toHaveBeenCalledWith(sessionId, 'hello agent', [
      'attachment-1',
    ]);
  });

  test('POST /api/sessions/:id/input reports a failed handoff', async () => {
    const sessionId = '44444444-4444-4444-8444-444444444444';
    mockSessionManager.startInput.mockRejectedValue(new Error('Session is unavailable'));
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/input`,
      headers: { authorization: 'Bearer test-secret' },
      payload: { input: 'hello agent' },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      message: 'Session is unavailable',
    });
  });

  test('GET /api/sessions/:id/events/stream resuscitates and streams', async () => {
    const projectId = 'proj-123';
    const sessionId = '55555555-5555-4555-8555-555555555555';

    // Insert dummy project and session in db
    await db.insert(projects).values({
      id: projectId,
      name: 'Test Project',
      path: '/tmp/test-proj',
    });

    await db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch: 'main',
      worktreePath: '/tmp/worktree-1',
      taskSlug: 'task-1',
      agent: 'claude-acp',
      selectedProvider: 'claude-acp',
      baseCommit: 'none',
    });

    mockSessionManager.getOrResuscitate.mockResolvedValue({
      id: sessionId,
      getLiveEventSnapshots: () => [],
    });

    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === 'string' ? 3000 : (address?.port ?? 3000);

    let req!: http.ClientRequest;
    const promise = new Promise<string>((resolve, reject) => {
      let buffer = '';
      req = http.get(
        `http://localhost:${String(port)}/api/sessions/${sessionId}/events/stream`,
        {
          headers: {
            authorization: 'Bearer test-secret',
          },
        },
        (res) => {
          res.on('data', (chunk: Buffer | string) => {
            buffer += chunk.toString();
            // Once we get the custom event, we can resolve and destroy the response stream to clean up
            if (buffer.includes('Hello from stream')) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      activeRequests.push(req);
      req.on('error', (err) => {
        // req.destroy() triggers an ECONNRESET error which we can ignore
        if (buffer.includes('Hello from stream')) {
          resolve(buffer);
        } else {
          reject(err);
        }
      });
    });

    // Wait for the subscriber to be registered on the eventBus
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (app.eventBus.listenerCount(sessionId) > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });

    // Publish an event to eventBus to see if it is received
    const testEvent: SessionEventRow = {
      id: 123,
      sessionId,
      type: 'text',
      data: { content: 'Hello from stream' },
      createdAt: new Date(),
    };
    app.eventBus.publish(testEvent);

    const body = await promise;
    expect(body).toContain(':\n\n');
    expect(body).toContain('id: 123');
    expect(body).toContain('event: session_event');
    expect(body).toContain('Hello from stream');
  });

  test('GET /api/events/stream publishes app-wide state changes', async () => {
    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === 'string' ? 3000 : (address?.port ?? 3000);

    let req!: http.ClientRequest;
    const promise = new Promise<string>((resolve, reject) => {
      let buffer = '';
      req = http.get(
        `http://localhost:${String(port)}/api/events/stream`,
        { headers: { authorization: 'Bearer test-secret' } },
        (res) => {
          res.on('data', (chunk: Buffer | string) => {
            buffer += chunk.toString();
            if (buffer.includes('"topics":["providers"]')) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      activeRequests.push(req);
      req.on('error', (err) => {
        if (buffer.includes('"topics":["providers"]')) resolve(buffer);
        else reject(err);
      });
    });

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (app.eventBus.stateListenerCount() > 0) {
          clearInterval(interval);
          resolve();
        }
      }, 5);
    });

    app.eventBus.publishState({ topics: ['providers'] });

    const body = await promise;
    expect(body).toContain('event: state_ready');
    expect(body).toContain('event: state_change');
    expect(body).toContain('"topics":["providers"]');
  });

  test('GET /api/sessions/:id/events/stream replays missed events based on Last-Event-ID', async () => {
    const projectId = 'proj-123';
    const sessionId = '66666666-6666-4666-8666-666666666666';

    // Insert dummy project and session in db
    await db.insert(projects).values({
      id: projectId,
      name: 'Test Project',
      path: '/tmp/test-proj',
    });

    await db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch: 'main',
      worktreePath: '/tmp/worktree-1',
      taskSlug: 'task-1',
      agent: 'claude-acp',
      selectedProvider: 'claude-acp',
      baseCommit: 'none',
    });

    // Insert two events
    await db.insert(sessionEvents).values({
      id: 1,
      sessionId,
      type: 'text',
      data: JSON.stringify({ content: 'first' }),
    });

    await db.insert(sessionEvents).values({
      id: 2,
      sessionId,
      type: 'text',
      data: JSON.stringify({ content: 'second' }),
    });

    mockSessionManager.getOrResuscitate.mockResolvedValue({
      id: sessionId,
      getLiveEventSnapshots: () => [],
    });

    await app.listen({ port: 0 });
    const address = app.server.address();
    const port = typeof address === 'string' ? 3000 : (address?.port ?? 3000);

    let req!: http.ClientRequest;
    const promise = new Promise<string>((resolve, reject) => {
      let buffer = '';
      req = http.get(
        `http://localhost:${String(port)}/api/sessions/${sessionId}/events/stream`,
        {
          headers: {
            authorization: 'Bearer test-secret',
            'Last-Event-ID': '1',
          },
        },
        (res) => {
          res.on('data', (chunk: Buffer | string) => {
            buffer += chunk.toString();
            // We should receive the replayed event 2 (which contains "second")
            if (buffer.includes('second')) {
              req.destroy();
              resolve(buffer);
            }
          });
        },
      );
      activeRequests.push(req);
      req.on('error', (err) => {
        if (buffer.includes('second')) {
          resolve(buffer);
        } else {
          reject(err);
        }
      });
    });

    const body = await promise;
    expect(body).toContain('id: 2');
    expect(body).not.toContain('first');
    expect(body).toContain('second');
  });
});
