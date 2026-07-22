import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase, mcpServers } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';
import { eq } from 'drizzle-orm';

interface McpServerResponse {
  autoApprove: boolean;
  approvalPolicy: string;
}

describe('MCP Servers REST API endpoints - Bidirectional Sync', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;
  const mockSessionManager = {
    handleClientMessage: vi.fn(),
    getOrResuscitate: vi.fn(),
    stopAll: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
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

  test('POST /api/mcp-servers - legacy client sends autoApprove: true without approvalPolicy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        id: 'srv-1',
        name: 'Srv 1',
        enabled: false,
        autoApprove: true,
        type: 'remote',
        url: 'http://localhost:8080',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as McpServerResponse;
    expect(body.autoApprove).toBe(true);
    expect(body.approvalPolicy).toBe('auto_approve_all');

    // Verify DB entry
    const dbRow = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, 'srv-1'),
    });
    expect(dbRow?.autoApprove).toBe(true);
    expect(dbRow?.approvalPolicy).toBe('auto_approve_all');
  });

  test('POST /api/mcp-servers - legacy client sends autoApprove: false without approvalPolicy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        id: 'srv-2',
        name: 'Srv 2',
        enabled: false,
        autoApprove: false,
        type: 'remote',
        url: 'http://localhost:8080',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as McpServerResponse;
    expect(body.autoApprove).toBe(false);
    expect(body.approvalPolicy).toBe('always_prompt');
  });

  test('POST /api/mcp-servers - client sends explicit approvalPolicy: deny_all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp-servers',
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        id: 'srv-3',
        name: 'Srv 3',
        enabled: false,
        autoApprove: true, // should be overridden by approvalPolicy
        approvalPolicy: 'deny_all',
        type: 'remote',
        url: 'http://localhost:8080',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as McpServerResponse;
    expect(body.autoApprove).toBe(false);
    expect(body.approvalPolicy).toBe('deny_all');
  });

  test('PATCH /api/mcp-servers/:id - updates approvalPolicy via legacy autoApprove', async () => {
    // Insert initial
    await db.insert(mcpServers).values({
      id: 'srv-4',
      name: 'Srv 4',
      enabled: false,
      autoApprove: false,
      approvalPolicy: 'always_prompt',
      type: 'remote',
      url: 'http://localhost:8080',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/mcp-servers/srv-4',
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        autoApprove: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as McpServerResponse;
    expect(body.autoApprove).toBe(true);
    expect(body.approvalPolicy).toBe('auto_approve_all');

    // Verify DB entry
    const dbRow = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, 'srv-4'),
    });
    expect(dbRow?.autoApprove).toBe(true);
    expect(dbRow?.approvalPolicy).toBe('auto_approve_all');
  });

  test('PATCH /api/mcp-servers/:id - updates autoApprove via approvalPolicy', async () => {
    // Insert initial
    await db.insert(mcpServers).values({
      id: 'srv-5',
      name: 'Srv 5',
      enabled: false,
      autoApprove: true,
      approvalPolicy: 'auto_approve_all',
      type: 'remote',
      url: 'http://localhost:8080',
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/mcp-servers/srv-5',
      headers: {
        authorization: 'Bearer test-secret',
      },
      payload: {
        approvalPolicy: 'always_prompt',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as McpServerResponse;
    expect(body.autoApprove).toBe(false);
    expect(body.approvalPolicy).toBe('always_prompt');
  });
});
