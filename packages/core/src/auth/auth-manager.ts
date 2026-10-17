import crypto from 'node:crypto';
import type { CoreDatabase } from '../db/index.js';
import { BrowserSessionStore } from './browser-session-store.js';
import type { BrowserSession } from './types.js';

export interface PairingToken {
  token: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export type { BrowserSession } from './types.js';

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
  private readonly sessions: BrowserSessionStore;
  private readonly startupTokenTtlMs: number;
  private readonly desktopCapability: string | null;
  private readonly now: () => number;

  constructor(options: AuthManagerOptions) {
    this.startupTokenTtlMs = options.startupTokenTtlMs ?? 15 * 60 * 1000;
    this.desktopCapability = options.desktopCapability ?? null;
    this.now = options.now ?? Date.now;
    this.sessions = new BrowserSessionStore(
      options.db,
      options.browserSessionTtlMs ?? 30 * 24 * 60 * 60 * 1000,
      this.now,
    );
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
    for (const [token, pairing] of this.pairingTokens) {
      if (pairing.consumed || this.now() > pairing.expiresAt) this.pairingTokens.delete(token);
    }
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

  createBrowserSession(
    ...args: Parameters<BrowserSessionStore['createBrowserSession']>
  ): BrowserSession {
    return this.sessions.createBrowserSession(...args);
  }
  validateBrowserSession(id: string): boolean {
    return this.sessions.validateBrowserSession(id);
  }
  revokeSession(id: string): boolean {
    return this.sessions.revokeSession(id);
  }
  listActiveSessions(): ReturnType<BrowserSessionStore['listActiveSessions']> {
    return this.sessions.listActiveSessions();
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
