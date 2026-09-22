import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { CoreDatabase } from '../db/index.js';
import { authSessions } from '../db/schema.js';

export interface PairingToken {
  token: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface BrowserSession {
  id: string;
  clientLabel: string;
  ip: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
}

export interface AuthManagerOptions {
  db: CoreDatabase;
  startupTokenTtlMs?: number;
  browserSessionTtlMs?: number;
  desktopCapability?: string;
  now?: () => number;
}

export class AuthManager {
  private pairingTokens = new Map<string, PairingToken>();
  private startupToken: string | null = null;
  private readonly db: CoreDatabase;
  private readonly startupTokenTtlMs: number;
  private readonly browserSessionTtlMs: number;
  private readonly desktopCapability: string | null;
  private readonly now: () => number;

  constructor(options: AuthManagerOptions) {
    this.db = options.db;
    this.startupTokenTtlMs = options.startupTokenTtlMs ?? 15 * 60 * 1000;
    this.browserSessionTtlMs = options.browserSessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.desktopCapability = options.desktopCapability ?? null;
    this.now = options.now ?? Date.now;
    this.rotateStartupToken();
  }

  getStartupPairingToken(): string {
    if (!this.startupToken || !this.isPairingTokenUsable(this.startupToken)) {
      this.rotateStartupToken();
    }
    return this.startupToken!;
  }

  isDesktopCapability(token: string): boolean {
    if (!this.desktopCapability) return false;
    const actual = Buffer.from(token);
    const expected = Buffer.from(this.desktopCapability);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  createPairingToken(opts?: { label?: string; ttlMs?: number }): {
    token: string;
    expiresAt: Date;
  } {
    const token = crypto.randomBytes(24).toString('hex');
    const ttl = opts?.ttlMs ?? 5 * 60 * 1000; // default 5 minutes
    const now = this.now();
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
  ): BrowserSession {
    const pairing = this.pairingTokens.get(token);
    if (!pairing) {
      throw new Error('Invalid pairing token');
    }

    if (pairing.consumed) {
      throw new Error('Pairing token has already been consumed');
    }

    if (this.now() > pairing.expiresAt) {
      this.pairingTokens.delete(token);
      throw new Error('Pairing token has expired');
    }

    // Burn token immediately
    pairing.consumed = true;
    this.pairingTokens.delete(token);

    return this.createBrowserSession(clientMetadata);
  }

  createBrowserSession(clientMetadata?: { userAgent?: string; ip?: string }): BrowserSession {
    const sessionId = `csess_${crypto.randomBytes(12).toString('hex')}`;
    const now = this.now();

    const session: BrowserSession = {
      id: sessionId,
      clientLabel: clientMetadata?.userAgent || 'Unknown device',
      ip: clientMetadata?.ip || '127.0.0.1',
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + this.browserSessionTtlMs,
    };

    this.db
      .insert(authSessions)
      .values({
        id: session.id,
        clientLabel: session.clientLabel,
        ip: session.ip,
        createdAt: new Date(session.createdAt),
        lastActiveAt: new Date(session.lastActiveAt),
        expiresAt: new Date(session.expiresAt),
      })
      .run();

    return session;
  }

  validateBrowserSession(sessionId: string): boolean {
    const now = new Date(this.now());
    const session = this.db
      .select({ id: authSessions.id, lastActiveAt: authSessions.lastActiveAt })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, sessionId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
        ),
      )
      .get();
    if (!session) return false;

    if (now.getTime() - session.lastActiveAt.getTime() >= 60_000) {
      this.db
        .update(authSessions)
        .set({ lastActiveAt: now })
        .where(eq(authSessions.id, sessionId))
        .run();
    }
    return true;
  }

  revokeSession(sessionId: string): boolean {
    const session = this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
      .get();
    if (!session) return false;

    this.db
      .update(authSessions)
      .set({ revokedAt: new Date(this.now()) })
      .where(eq(authSessions.id, sessionId))
      .run();
    return true;
  }

  listActiveSessions(): Array<{
    id: string;
    clientLabel: string;
    ip: string;
    createdAt: Date;
    lastActiveAt: Date;
    expiresAt: Date;
  }> {
    const result: Array<{
      id: string;
      clientLabel: string;
      ip: string;
      createdAt: Date;
      lastActiveAt: Date;
      expiresAt: Date;
    }> = [];

    const rows = this.db
      .select()
      .from(authSessions)
      .where(and(isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date(this.now()))))
      .all();

    for (const session of rows) {
      result.push({
        id: session.id,
        clientLabel: session.clientLabel,
        ip: session.ip,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt,
      });
    }

    return result;
  }

  private rotateStartupToken(): void {
    if (this.startupToken) this.pairingTokens.delete(this.startupToken);
    this.startupToken = this.createPairingToken({
      label: 'startup-bootstrap',
      ttlMs: this.startupTokenTtlMs,
    }).token;
  }

  private isPairingTokenUsable(token: string): boolean {
    const pairing = this.pairingTokens.get(token);
    if (!pairing || pairing.consumed || this.now() > pairing.expiresAt) {
      this.pairingTokens.delete(token);
      return false;
    }
    return true;
  }
}
