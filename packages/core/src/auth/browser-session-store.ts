import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbClient } from '../db/index.js';
import { authSessions } from '../db/schema.js';
import type { BrowserSession } from './types.js';

/** Owns durable browser session creation, expiry, activity touches and revocation. */
export class BrowserSessionStore {
  constructor(
    private readonly db: DbClient,
    private readonly browserSessionTtlMs: number,
    private readonly now: () => number,
  ) {}
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
}
