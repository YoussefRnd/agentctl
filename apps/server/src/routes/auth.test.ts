import { test, expect, describe, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import { createDatabase } from '@agentctl/core/db';
import type { FastifyInstance } from 'fastify';
import { parseServerEnv } from '@agentctl/shared';

describe('Ephemeral Pairing & Auth API routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createDatabase>;

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
      env: testEnv,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /api/auth/status returns auth status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { authenticated: boolean; mode: string };
    expect(body).toHaveProperty('authenticated');
    expect(body).toHaveProperty('mode');
  });

  test('POST /api/auth/pairing/consume burns the pairing token and issues a session token', async () => {
    const startupToken = app.authManager.getStartupToken();

    // 1. Consume pairing token
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      payload: { pairingToken: startupToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { sessionToken: string; sessionId: string };
    expect(body.sessionToken).toMatch(/^agtoken_/);
    expect(body.sessionId).toMatch(/^csess_/);

    // 2. Subsequent attempt to reuse pairing token should fail
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      payload: { pairingToken: startupToken },
    });
    expect(replayRes.statusCode).toBe(401);

    // 3. Request with issued Bearer token succeeds
    const protectedRes = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: {
        authorization: `Bearer ${body.sessionToken}`,
      },
    });
    expect(protectedRes.statusCode).toBe(200);
  });

  test('POST /api/auth/pairing/create generates a new pairing token', async () => {
    const directSession = app.authManager.createDirectSession();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/create',
      headers: {
        authorization: `Bearer ${directSession.sessionToken}`,
      },
      payload: {
        label: 'iPhone Pairing',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string; pairingUrl: string };
    expect(body.token).toBeDefined();
    expect(body.pairingUrl).toContain(body.token);
  });

  test('GET /api/auth/sessions and DELETE /api/auth/sessions/:id manages connected sessions', async () => {
    const directSession = app.authManager.createDirectSession();

    // List sessions
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: {
        authorization: `Bearer ${directSession.sessionToken}`,
      },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions.some((s) => s.id === directSession.sessionId)).toBe(true);

    // Revoke session
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${directSession.sessionId}`,
      headers: {
        authorization: `Bearer ${directSession.sessionToken}`,
      },
    });

    expect(revokeRes.statusCode).toBe(200);

    // Verify token is now rejected for remote request
    const checkRes = await app.inject({
      method: 'GET',
      url: '/api/projects',
      remoteAddress: '192.168.1.100',
      headers: {
        authorization: `Bearer ${directSession.sessionToken}`,
      },
    });
    expect(checkRes.statusCode).toBe(401);
  });
});
