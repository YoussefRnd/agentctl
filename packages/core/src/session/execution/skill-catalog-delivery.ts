import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AgentSession } from '../../agent/types.js';
import type { DbClient } from '../../db/index.js';
import { sessions, sessionSkillCatalogs } from '../../db/schema.js';
import type { SkillActivation, SkillRegistry } from '../../skills/registry.js';

/** Receipts survive reconnects, but never cross provider-owned conversations. */
export class SkillCatalogDelivery {
  private initializedScope?: string;

  constructor(
    private db: DbClient,
    private sessionId: string,
    private agent: AgentSession,
  ) {}

  private scope() {
    if (!this.agent.id) return undefined;
    const session = this.db.select().from(sessions).where(eq(sessions.id, this.sessionId)).get();
    if (!session) return undefined;
    const identity = {
      sessionId: this.sessionId,
      providerId: session.selectedProvider,
      nativeSessionId: this.agent.id,
    };
    const where = and(
      eq(sessionSkillCatalogs.sessionId, identity.sessionId),
      eq(sessionSkillCatalogs.providerId, identity.providerId),
      eq(sessionSkillCatalogs.nativeSessionId, identity.nativeSessionId),
    );
    const key = JSON.stringify(identity);
    if (this.initializedScope !== key) {
      // Some providers reuse IDs. A genuinely fresh conversation knows nothing yet.
      if (this.agent.history === 'fresh') this.db.delete(sessionSkillCatalogs).where(where).run();
      this.initializedScope = key;
    }
    return { identity, where };
  }

  compacted(compactionId: string): void {
    const scope = this.scope();
    if (!scope) return;
    const previous = this.db.select().from(sessionSkillCatalogs).where(scope.where).get();
    // Replayed notifications for the last observed compaction do not invalidate twice.
    if (previous?.compactionId === compactionId) return;
    this.db
      .insert(sessionSkillCatalogs)
      .values({ ...scope.identity, catalogHash: null, compactionId })
      .onConflictDoUpdate({
        target: [
          sessionSkillCatalogs.sessionId,
          sessionSkillCatalogs.providerId,
          sessionSkillCatalogs.nativeSessionId,
        ],
        set: { catalogHash: null, compactionId },
      })
      .run();
  }

  prepare(registry: SkillRegistry, activation?: SkillActivation) {
    const scope = this.scope();
    const previous = scope
      ? this.db.select().from(sessionSkillCatalogs).where(scope.where).get()
      : undefined;
    const catalog = registry.formatCatalog();
    const catalogHash = createHash('sha256').update(catalog).digest('hex');
    const changed = previous?.catalogHash !== catalogHash;
    const catalogContext = changed
      ? catalog ||
        (previous ? '## Available Agent Skills\nNo AgentCtl skills are currently available.' : '')
      : '';
    return {
      context: [catalogContext, registry.formatActivation(activation)]
        .filter(Boolean)
        .join('\n\n---\n\n'),
      delivered: () => {
        if (!scope || !changed) return;
        const current = this.db.select().from(sessionSkillCatalogs).where(scope.where).get();
        // Compaction during this prompt may have discarded the catalog we just sent.
        if ((current?.compactionId ?? null) !== (previous?.compactionId ?? null)) return;
        this.db
          .insert(sessionSkillCatalogs)
          .values({ ...scope.identity, catalogHash, compactionId: previous?.compactionId ?? null })
          .onConflictDoUpdate({
            target: [
              sessionSkillCatalogs.sessionId,
              sessionSkillCatalogs.providerId,
              sessionSkillCatalogs.nativeSessionId,
            ],
            set: { catalogHash },
          })
          .run();
      },
    };
  }
}
