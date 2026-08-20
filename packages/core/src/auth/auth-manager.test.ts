import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from './auth-manager.js';

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = new AuthManager();
  });

  it('generates a startup pairing token upon initialization', () => {
    const startupToken = auth.getStartupToken();
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

    expect(session.sessionId).toMatch(/^csess_/);
    expect(session.sessionToken).toMatch(/^agtoken_/);

    // Validate the issued session token
    const validation = auth.validateSessionToken(session.sessionToken);
    expect(validation.valid).toBe(true);
    expect(validation.sessionId).toBe(session.sessionId);

    // Ensure pairing token cannot be reused (one-time use / self-destructing)
    expect(() => auth.consumePairingToken(token)).toThrow('Invalid pairing token');
  });

  it('rejects expired pairing tokens', () => {
    const { token } = auth.createPairingToken({ label: 'short-lived', ttlMs: -1000 });
    expect(() => auth.consumePairingToken(token)).toThrow('Pairing token has expired');
  });

  it('lists active sessions and supports single-device revocation', () => {
    const { token } = auth.createPairingToken();
    const session = auth.consumePairingToken(token, {
      userAgent: 'MacBook Safari',
      ip: '10.0.0.5',
    });

    const activeSessions = auth.listActiveSessions();
    expect(activeSessions.length).toBeGreaterThanOrEqual(1);
    expect(activeSessions.some((s) => s.id === session.sessionId)).toBe(true);

    // Revoke the session
    const revoked = auth.revokeSession(session.sessionId);
    expect(revoked).toBe(true);

    // Validation should now fail
    const check = auth.validateSessionToken(session.sessionToken);
    expect(check.valid).toBe(false);

    // Should no longer appear in active list
    const updatedSessions = auth.listActiveSessions();
    expect(updatedSessions.some((s) => s.id === session.sessionId)).toBe(false);
  });
});
