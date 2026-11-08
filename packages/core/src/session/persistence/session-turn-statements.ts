import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { providers, sessions, sessionSkillCatalogs, sessionTurnAttempts } from '../../db/schema.js';

export type CatalogIdentity = Pick<
  typeof sessionSkillCatalogs.$inferInsert,
  'sessionId' | 'providerId' | 'nativeSessionId'
>;

/** Fixed turn queries; bind fresh identities, values and encoded dates on every execution. */
export function prepareTurnStatements(db: DbClient) {
  const catalogScope = and(
    eq(sessionSkillCatalogs.sessionId, sql.placeholder('sessionId')),
    eq(sessionSkillCatalogs.providerId, sql.placeholder('providerId')),
    eq(sessionSkillCatalogs.nativeSessionId, sql.placeholder('nativeSessionId')),
  );
  const catalogIdentity = {
    sessionId: sql.placeholder('sessionId'),
    providerId: sql.placeholder('providerId'),
    nativeSessionId: sql.placeholder('nativeSessionId'),
  };
  const catalogTarget = [
    sessionSkillCatalogs.sessionId,
    sessionSkillCatalogs.providerId,
    sessionSkillCatalogs.nativeSessionId,
  ];
  return {
    session: db
      .select({
        title: sessions.title,
        taskSlug: sessions.taskSlug,
        selectedProvider: sessions.selectedProvider,
        selectedModel: sessions.selectedModel,
        sessionConfigOptions: sessions.sessionConfigOptions,
        sessionMetrics: sessions.sessionMetrics,
        contextLimit: sessions.contextLimit,
        contextUsedTokens: sessions.contextUsedTokens,
        estimatedCost: sessions.estimatedCost,
      })
      .from(sessions)
      .where(eq(sessions.id, sql.placeholder('sessionId')))
      .prepare(),
    provider: db
      .select({ nativelyLoadsSkills: providers.nativelyLoadsSkills })
      .from(providers)
      .where(eq(providers.id, sql.placeholder('providerId')))
      .prepare(),
    status: db
      .update(sessions)
      .set({
        status: sql`${sql.placeholder('status')}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessions.updatedAt)}`,
      })
      .where(eq(sessions.id, sql.placeholder('sessionId')))
      .prepare(),
    finish: db
      .update(sessionTurnAttempts)
      .set({
        status: sql`${sql.placeholder('status')}`,
        endedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.endedAt)}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.updatedAt)}`,
      })
      .where(
        and(
          eq(sessionTurnAttempts.id, sql.placeholder('attemptId')),
          inArray(sessionTurnAttempts.status, ['running', 'waiting']),
        ),
      )
      .prepare(),
    dispatch: db
      .update(sessionTurnAttempts)
      .set({
        dispatchedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.dispatchedAt)}`,
        updatedAt: sql`${sql.param(sql.placeholder('now'), sessionTurnAttempts.updatedAt)}`,
      })
      .where(
        and(
          eq(sessionTurnAttempts.id, sql.placeholder('attemptId')),
          inArray(sessionTurnAttempts.status, ['running', 'waiting']),
        ),
      )
      .returning({ id: sessionTurnAttempts.id })
      .prepare(),
    catalog: db
      .select({
        catalogHash: sessionSkillCatalogs.catalogHash,
        compactionId: sessionSkillCatalogs.compactionId,
      })
      .from(sessionSkillCatalogs)
      .where(catalogScope)
      .prepare(),
    clearCatalog: db.delete(sessionSkillCatalogs).where(catalogScope).prepare(),
    compactCatalog: db
      .insert(sessionSkillCatalogs)
      .values({
        ...catalogIdentity,
        catalogHash: null,
        compactionId: sql.placeholder('compactionId'),
      })
      .onConflictDoUpdate({
        target: catalogTarget,
        set: { catalogHash: null, compactionId: sql`${sql.placeholder('compactionId')}` },
      })
      .prepare(),
    deliverCatalog: db
      .insert(sessionSkillCatalogs)
      .values({
        ...catalogIdentity,
        catalogHash: sql.placeholder('catalogHash'),
        compactionId: sql.placeholder('compactionId'),
      })
      .onConflictDoUpdate({
        target: catalogTarget,
        set: { catalogHash: sql`${sql.placeholder('catalogHash')}` },
      })
      .prepare(),
  };
}
