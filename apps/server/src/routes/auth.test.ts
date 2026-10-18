import { test, expect, describe, beforeEach, afterEach } from 'vite-plus/test';
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
      NODE_ENV: 'production',
      AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
      AGENTCTL_SESSION_SALT: 'test-session-sal',
      PORT: '0',
    });

    app = await buildApp({
      db,
      env: testEnv,
    });
  });

  async function pairClient(label = 'Test browser') {
    const pairingToken = app.authManager.getStartupPairingToken();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      remoteAddress: '192.168.1.100',
      headers: { 'user-agent': label },
      payload: { pairingToken },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const cookieHeader = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookieHeader).toBeDefined();
    return { response, cookieHeader: cookieHeader! };
  }

  afterEach(async () => {
    await app.close();
  });

  test('GET /api/auth/status returns auth status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      authenticated: boolean;
      authRequired: boolean;
      mode: string;
    };
    expect(body).toEqual({ authenticated: false, authRequired: true, mode: 'production' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  test('POST /api/auth/pairing/consume burns the pairing token and creates a cookie session', async () => {
    const startupToken = app.authManager.getStartupPairingToken();

    // 1. Consume pairing token
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      remoteAddress: '192.168.1.100',
      payload: { pairingToken: startupToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { success: boolean; session: { id: string } };
    expect(body.success).toBe(true);
    expect(body.session.id).toMatch(/^csess_/);
    const setCookie = res.headers['set-cookie'];
    const sessionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookieHeader = sessionCookie?.split(';')[0];
    expect(cookieHeader).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Strict');
    expect(sessionCookie).toContain('Max-Age=2592000');

    // 2. Subsequent attempt to reuse pairing token should fail
    const replayRes = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      remoteAddress: '192.168.1.100',
      payload: { pairingToken: startupToken },
    });
    expect(replayRes.statusCode).toBe(401);

    const replayAsBearer = await app.inject({
      method: 'GET',
      url: '/api/projects',
      remoteAddress: '192.168.1.100',
      headers: {
        authorization: `Bearer ${startupToken}`,
      },
    });
    expect(replayAsBearer.statusCode).toBe(401);

    // 3. The cookie-backed session succeeds; no browser bearer token is issued.
    const protectedRes = await app.inject({
      method: 'GET',
      url: '/api/projects',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader!,
      },
    });
    expect(protectedRes.statusCode).toBe(200);

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/auth/status',
      remoteAddress: '192.168.1.100',
      headers: { cookie: cookieHeader! },
    });
    expect(statusRes.json()).toMatchObject({ authenticated: true, authRequired: true });
  });

  test('rate limits repeated invalid authentication attempts', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/pairing/consume',
        remoteAddress: '192.168.1.101',
        payload: { pairingToken: `invalid-${attempt.toString()}` },
      });
      expect(res.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/consume',
      remoteAddress: '192.168.1.101',
      payload: { pairingToken: 'still-invalid' },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  test('POST /api/auth/pairing/create generates a new pairing token', async () => {
    const { cookieHeader } = await pairClient();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/create',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
      },
      payload: {
        label: 'iPhone Pairing',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { token: string; pairingUrl: string };
    expect(body.token).toBeDefined();
    expect(body.pairingUrl).toContain(`#pairing=${body.token}`);
    expect(body.pairingUrl).not.toContain('?pairing=');
  });

  test('rejects credentialed reads from an untrusted localhost origin', async () => {
    const { cookieHeader } = await pairClient();

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost:9999',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  test('rejects cookie-authenticated mutations from an untrusted browser origin', async () => {
    const { cookieHeader } = await pairClient();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing/create',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
        origin: 'http://localhost:9999',
      },
      payload: { label: 'Untrusted origin' },
    });

    expect(response.statusCode).toBe(403);
  });

  test('accepts the per-launch capability only for the embedded desktop server', async () => {
    const embeddedApp = await buildApp({
      db: createDatabase(':memory:'),
      env: parseServerEnv({
        NODE_ENV: 'production',
        AGENTCTL_SESSION_KEY: 'desktop-session-key-desktop-key-123456',
        AGENTCTL_SESSION_SALT: 'desktop-salt-123',
        PORT: '0',
      }),
      embedded: true,
      desktopCapability: 'test-desktop-capability',
    });

    try {
      const authorized = await embeddedApp.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { authorization: 'Bearer test-desktop-capability' },
      });
      expect(authorized.statusCode).toBe(200);

      const rejected = await embeddedApp.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { authorization: 'Bearer wrong-capability' },
      });
      expect(rejected.statusCode).toBe(401);
    } finally {
      await embeddedApp.close();
    }
  });

  test('GET /api/auth/sessions and DELETE /api/auth/sessions/:id manages connected sessions', async () => {
    const { cookieHeader } = await pairClient('MacBook Safari');

    // List sessions
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions).toHaveLength(1);
    const sessionId = listBody.sessions[0].id;

    // Revoke session
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${sessionId}`,
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(revokeRes.statusCode).toBe(200);

    // Verify the same browser cookie is now rejected.
    const checkRes = await app.inject({
      method: 'GET',
      url: '/api/projects',
      remoteAddress: '192.168.1.100',
      headers: {
        cookie: cookieHeader,
      },
    });
    expect(checkRes.statusCode).toBe(401);
  });
});
