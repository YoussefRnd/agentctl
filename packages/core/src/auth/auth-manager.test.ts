import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from './auth-manager.js';
import { createDatabase } from '../db/index.js';

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = new AuthManager({ db: createDatabase(':memory:') });
  });

  it('generates a startup pairing token upon initialization', () => {
    const startupToken = auth.getStartupPairingToken();
    expect(startupToken).toBeDefined();
    expect(startupToken.length).toBeGreaterThan(16);
  });

  it('creates and consumes a one-time pairing token successfully', () => {
    const { token } = auth.createPairingToken({ label: 'test-device', ttlMs: 60000 });
    expect(token).toBeDefined();

    const session = auth.consumePairingToken(token, {
      userAgent: 'Mozilla/5.0 (iPhone)',
      ip: '192.168.1.50',
    });

    expect(session.id).toMatch(/^csess_/);
    expect(auth.validateBrowserSession(session.id)).toBe(true);

    // Ensure pairing token cannot be reused (one-time use / self-destructing)
    expect(() => auth.consumePairingToken(token)).toThrow('Invalid pairing token');
  });

  it('rejects expired pairing tokens', () => {
    const { token } = auth.createPairingToken({ label: 'short-lived', ttlMs: -1000 });
    expect(() => auth.consumePairingToken(token)).toThrow('Pairing token has expired');
  });

  it('rotates an expired or consumed startup token', () => {
    let now = 1_000;
    const expiringAuth = new AuthManager({
      db: createDatabase(':memory:'),
      startupTokenTtlMs: 100,
      now: () => now,
    });
    const firstToken = expiringAuth.getStartupPairingToken();

    now += 101;
    const secondToken = expiringAuth.getStartupPairingToken();
    expect(secondToken).not.toBe(firstToken);

    expiringAuth.consumePairingToken(secondToken);
    expect(expiringAuth.getStartupPairingToken()).not.toBe(secondToken);
  });

  it('expires client sessions and removes them from the active list', () => {
    let now = 1_000;
    const expiringAuth = new AuthManager({
      db: createDatabase(':memory:'),
      browserSessionTtlMs: 100,
      now: () => now,
    });
    const session = expiringAuth.createBrowserSession();

    now += 101;
    expect(expiringAuth.validateBrowserSession(session.id)).toBe(false);
    expect(expiringAuth.listActiveSessions()).toHaveLength(0);
  });

  it('lists active sessions and supports single-device revocation', () => {
    const { token } = auth.createPairingToken();
    const session = auth.consumePairingToken(token, {
      userAgent: 'MacBook Safari',
      ip: '10.0.0.5',
    });

    const activeSessions = auth.listActiveSessions();
    expect(activeSessions.length).toBeGreaterThanOrEqual(1);
    expect(activeSessions.some((s) => s.id === session.id)).toBe(true);

    // Revoke the session
    const revoked = auth.revokeSession(session.id);
    expect(revoked).toBe(true);

    // Validation should now fail
    expect(auth.validateBrowserSession(session.id)).toBe(false);

    // Should no longer appear in active list
    const updatedSessions = auth.listActiveSessions();
    expect(updatedSessions.some((s) => s.id === session.id)).toBe(false);
  });

  it('persists browser sessions across manager restarts', () => {
    const db = createDatabase(':memory:');
    const firstManager = new AuthManager({ db });
    const session = firstManager.createBrowserSession({ userAgent: 'Firefox' });

    const restartedManager = new AuthManager({ db });
    expect(restartedManager.validateBrowserSession(session.id)).toBe(true);
  });

  it('accepts the desktop capability only when explicitly configured', () => {
    const desktopAuth = new AuthManager({
      db: createDatabase(':memory:'),
      desktopCapability: 'ephemeral-desktop-capability',
    });

    expect(desktopAuth.isDesktopCapability('ephemeral-desktop-capability')).toBe(true);
    expect(desktopAuth.isDesktopCapability('wrong-capability')).toBe(false);
    expect(auth.isDesktopCapability('ephemeral-desktop-capability')).toBe(false);
  });
});
