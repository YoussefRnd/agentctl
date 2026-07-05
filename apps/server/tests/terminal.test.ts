/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, projects, sessions } from '@agentctl/core';
import type { FastifyInstance } from 'fastify';

describe('Fastify Terminal Input API Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

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
      worktreePath: '/tmp/test',
      taskSlug: 'test-task',
    });

    // 2. Start session inside SessionManager so it is in memory
    // We can manually add a mock session to stateMachine sessions map
    const mockSession = {
      sessionId,
      writeTerminalInput: (terminalId: string, data: string) => {
        expect(terminalId).toBe('term-123');
        expect(data).toBe('hello\n');
        return true;
      },
      stop: () => Promise.resolve(),
    };
    (app.sessionManager as any).stateMachine.sessions.set(sessionId, mockSession);

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
    const body = JSON.parse(response.payload);
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
