import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, projects, sessions } from '@agentctl/core';
import type { FastifyInstance } from 'fastify';

interface TestSession {
  writeTerminalInput(terminalId: string, data: string): boolean;
  stop(): Promise<void>;
}

interface TestableSessionManager {
  stateMachine: { sessions: Map<string, TestSession> };
}

describe('Fastify Terminal Input API Integration Tests', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    db = createDatabase(':memory:');

    // Inject custom db so we don't use real SQLite file on disk
    app = await buildApp({ db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('POST /api/sessions/:id/terminal/:terminalId/input should invoke SessionManager.writeTerminalInput', async () => {
    const sessionId = 'd3b07384-d113-4ec5-a587-c8c7f9999999';
    const projectId = 'project-1';

    // 1. Seed project and session in mock DB
    await db.insert(projects).values({
      id: projectId,
      name: 'Test Project',
      path: '/tmp/test',
    });

    await db.insert(sessions).values({
      id: sessionId,
      projectId,
      status: 'idle',
      branch: 'main',
      baseCommit: 'none',
      mode: 'local',
      agent: 'test-agent',
      selectedProvider: 'test-agent',
      worktreePath: '/tmp/test',
      taskSlug: 'test-task',
    });

    // 2. Register a mock session in the in-memory state machine so
    //    SessionManager.writeTerminalInput can find it.
    const mockSession: TestSession = {
      writeTerminalInput: (terminalId, data) => {
        expect(terminalId).toBe('term-123');
        expect(data).toBe('hello\n');
        return true;
      },
      stop: () => Promise.resolve(),
    };
    (app.sessionManager as unknown as TestableSessionManager).stateMachine.sessions.set(
      sessionId,
      mockSession,
    );

    // 3. Make HTTP request to our new endpoint
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/terminal/term-123/input`,
      headers: {
        Authorization: `Bearer ${app.config.AGENTCTL_SECRET}`,
      },
      payload: {
        data: 'hello\n',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { success: boolean };
    expect(body).toEqual({ success: true });
  });

  test('POST /api/sessions/:id/terminal/:terminalId/input returns 400 if validation fails', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/invalid-session-uuid/terminal/term-123/input`,
      headers: {
        Authorization: `Bearer ${app.config.AGENTCTL_SECRET}`,
      },
      payload: {
        data: 'hello\n',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
