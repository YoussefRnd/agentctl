import crypto from 'node:crypto';

export interface PairingToken {
  token: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface ClientSession {
  id: string;
  sessionToken: string;
  clientLabel: string;
  ip: string;
  createdAt: number;
  lastActiveAt: number;
  revoked: boolean;
}

export class AuthManager {
  private pairingTokens = new Map<string, PairingToken>();
  private clientSessions = new Map<string, ClientSession>();
  private tokenToSessionId = new Map<string, string>();
  private startupToken: string | null = null;

  constructor() {
    // Generate initial startup token
    this.startupToken = this.createPairingToken({
      label: 'startup-bootstrap',
      ttlMs: 15 * 60 * 1000, // 15 mins for initial startup
    }).token;
  }

  getStartupToken(): string {
    if (!this.startupToken) {
      this.startupToken = this.createPairingToken({
        label: 'startup-bootstrap',
        ttlMs: 15 * 60 * 1000,
      }).token;
    }
    return this.startupToken;
  }

  createPairingToken(opts?: { label?: string; ttlMs?: number }): {
    token: string;
    expiresAt: Date;
  } {
    const token = crypto.randomBytes(24).toString('hex');
    const ttl = opts?.ttlMs ?? 5 * 60 * 1000; // default 5 minutes
    const now = Date.now();
    const expiresAt = now + ttl;

    this.pairingTokens.set(token, {
      token,
      label: opts?.label ?? 'device-pairing',
      createdAt: now,
      expiresAt,
      consumed: false,
    });

    return { token, expiresAt: new Date(expiresAt) };
  }

  consumePairingToken(
    token: string,
    clientMetadata?: { userAgent?: string; ip?: string },
  ): { sessionToken: string; sessionId: string } {
    const pairing = this.pairingTokens.get(token);
    if (!pairing) {
      throw new Error('Invalid pairing token');
    }

    if (pairing.consumed) {
      throw new Error('Pairing token has already been consumed');
    }

    if (Date.now() > pairing.expiresAt) {
      this.pairingTokens.delete(token);
      throw new Error('Pairing token has expired');
    }

    // Burn token immediately
    pairing.consumed = true;
    this.pairingTokens.delete(token);

    // Create client session
    const sessionId = `csess_${crypto.randomBytes(12).toString('hex')}`;
    const sessionToken = `agtoken_${crypto.randomBytes(32).toString('hex')}`;
    const now = Date.now();

    const session: ClientSession = {
      id: sessionId,
      sessionToken,
      clientLabel: clientMetadata?.userAgent || 'Unknown device',
      ip: clientMetadata?.ip || '127.0.0.1',
      createdAt: now,
      lastActiveAt: now,
      revoked: false,
    };

    this.clientSessions.set(sessionId, session);
    this.tokenToSessionId.set(sessionToken, sessionId);

    return { sessionToken, sessionId };
  }

  createDirectSession(clientMetadata?: { userAgent?: string; ip?: string }): {
    sessionToken: string;
    sessionId: string;
  } {
    const sessionId = `csess_${crypto.randomBytes(12).toString('hex')}`;
    const sessionToken = `agtoken_${crypto.randomBytes(32).toString('hex')}`;
    const now = Date.now();

    const session: ClientSession = {
      id: sessionId,
      sessionToken,
      clientLabel: clientMetadata?.userAgent || 'Local Desktop / Dev',
      ip: clientMetadata?.ip || '127.0.0.1',
      createdAt: now,
      lastActiveAt: now,
      revoked: false,
    };

    this.clientSessions.set(sessionId, session);
    this.tokenToSessionId.set(sessionToken, sessionId);

    return { sessionToken, sessionId };
  }

  validateSessionToken(token: string): { valid: boolean; sessionId?: string } {
    const sessionId = this.tokenToSessionId.get(token);
    if (!sessionId) return { valid: false };

    const session = this.clientSessions.get(sessionId);
    if (!session || session.revoked) return { valid: false };

    session.lastActiveAt = Date.now();
    return { valid: true, sessionId };
  }

  revokeSession(sessionId: string): boolean {
    const session = this.clientSessions.get(sessionId);
    if (!session) return false;

    session.revoked = true;
    this.tokenToSessionId.delete(session.sessionToken);
    this.clientSessions.delete(sessionId);
    return true;
  }

  listActiveSessions(): Array<{
    id: string;
    clientLabel: string;
    ip: string;
    createdAt: Date;
    lastActiveAt: Date;
  }> {
    const result: Array<{
      id: string;
      clientLabel: string;
      ip: string;
      createdAt: Date;
      lastActiveAt: Date;
    }> = [];

    for (const s of this.clientSessions.values()) {
      if (!s.revoked) {
        result.push({
          id: s.id,
          clientLabel: s.clientLabel,
          ip: s.ip,
          createdAt: new Date(s.createdAt),
          lastActiveAt: new Date(s.lastActiveAt),
        });
      }
    }

    return result;
  }
}
