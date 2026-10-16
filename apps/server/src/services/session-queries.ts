import { and, eq, sql } from 'drizzle-orm';
import { sessions, sessionEvents, type DbClient } from '@agentctl/core/db';
import { readSessionExecutionState } from '@agentctl/core/session';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { sessionRowSchema } from '@agentctl/shared';
import { AppError } from '../errors/app-error.js';

export type SessionDetailRecord = Awaited<ReturnType<SessionQueries['findDetail']>>;

/** Queries do not restore workspaces, capture snapshots, or repair persisted metadata. */
export class SessionQueries {
  constructor(
    private readonly db: DbClient,
    private readonly providers: Pick<ProviderRegistry, 'discover'>,
  ) {}
  async list() {
    return (await this.db.select().from(sessions)).map((row) => sessionRowSchema.parse(row));
  }
  async findDetail(sessionId: string) {
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });
    if (!session) throw new AppError('Session not found', 404);
    return session;
  }
  execution(sessionId: string) {
    return readSessionExecutionState(this.db, sessionId);
  }
  async withCapabilities(session: SessionDetailRecord) {
    const capabilities = await this.providers.discover();
    return {
      session: sessionRowSchema.parse({
        ...session,
        hasUserActivity: await this.hasUserActivity(session.id),
      }),
      capabilities,
    };
  }
  private async hasUserActivity(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: sessionEvents.id })
      .from(sessionEvents)
      .where(
        and(
          eq(sessionEvents.sessionId, sessionId),
          eq(sessionEvents.type, 'text'),
          sql`json_extract(${sessionEvents.data}, '$.role') = 'user'`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
