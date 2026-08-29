import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, projects, sessions, acpEvents } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';

describe('Search & Project Provider Integration Tests', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  const mockSessionManager = {
    handleClientMessage: vi.fn(),
    getOrResuscitate: vi.fn(),
    stopAll: vi.fn(),
  };

  beforeEach(async () => {
    db = createDatabase(':memory:');

    const testEnv = parseServerEnv({
      AGENTCTL_SECRET: 'test-secret',
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
    await app.close();
  });

  test('GET /api/search/events matches user messages, agent responses, and tool calls with snippets', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const sessionId = '22222222-2222-4222-8222-222222222222';

    await db.insert(projects).values({
      id: projectId,
      name: 'Test Project',
      path: '/path/to/test-project',
      repoRoot: '/path/to/test-project',
      subdir: '',
    });

    await db.insert(sessions).values({
      id: sessionId,
      projectId,
      branch: 'agent/task-1',
      worktreePath: '/path/to/worktree',
      taskSlug: 'task-1',
      title: 'Refactor Authentication Service',
      baseCommit: 'abc1234',
      agent: 'claude-code',
      selectedProvider: 'claude-code',
      selectedModel: 'claude-3-7-sonnet',
      mode: 'worktree',
    });

    await db.insert(acpEvents).values([
      {
        sessionId,
        type: 'text',
        data: JSON.stringify({
          role: 'user',
          content: 'Please refactor the JWT authentication logic',
        }),
      },
      {
        sessionId,
        type: 'text',
        data: JSON.stringify({
          role: 'provider',
          content: 'I will now refactor the JWT authentication handler in auth.ts',
        }),
      },
      {
        sessionId,
        type: 'tool_call',
        data: JSON.stringify({
          name: 'edit_file',
          arguments: { path: 'auth.ts', query: 'JWT', marker: 'tool-argument-only' },
        }),
      },
      {
        sessionId,
        type: 'text',
        data: JSON.stringify({
          role: 'thought',
          content: 'Evaluating security implications of JWT refresh tokens',
        }),
      },
      {
        sessionId,
        type: 'text',
        data: JSON.stringify({
          role: 'provider',
          content: 'Whitespace before\n\n\nsnippet-match remains highlighted',
        }),
      },
    ]);

    // Search query 'JWT'
    const res = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=JWT',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.length).toBe(4);
    expect(body[0].sessionTitle).toBe('Refactor Authentication Service');
    expect(body[0].projectName).toBe('Test Project');

    // Filter by type=user
    const userRes = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=JWT&type=user',
    });
    expect(userRes.statusCode).toBe(200);
    const userBody = JSON.parse(userRes.body);
    expect(userBody.length).toBe(1);
    expect(userBody[0].eventType).toBe('user');
    expect(userBody[0].snippet).toContain('JWT');

    // Filter by type=thought
    const thoughtRes = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=JWT&type=thought',
    });
    expect(thoughtRes.statusCode).toBe(200);
    const thoughtBody = JSON.parse(thoughtRes.body);
    expect(thoughtBody.length).toBe(1);
    expect(thoughtBody[0].eventType).toBe('thought');

    const toolArgumentRes = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=tool-argument-only&type=tool',
    });
    expect(toolArgumentRes.statusCode).toBe(200);
    const toolArgumentBody = JSON.parse(toolArgumentRes.body);
    expect(toolArgumentBody).toHaveLength(1);
    expect(toolArgumentBody[0].eventType).toBe('tool');

    const snippetRes = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=snippet-match',
    });
    const snippetBody = JSON.parse(snippetRes.body);
    const [matchStart, matchEnd] = snippetBody[0].matchIndices;
    expect(snippetBody[0].snippet.slice(matchStart, matchEnd)).toBe('snippet-match');

    const invalidLimitRes = await app.inject({
      method: 'GET',
      url: '/api/search/events?q=JWT&limit=101',
    });
    expect(invalidLimitRes.statusCode).toBe(400);
  });
});
