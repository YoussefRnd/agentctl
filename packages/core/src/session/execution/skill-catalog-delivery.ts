import { createHash } from 'node:crypto';
import type { AgentSession } from '../../agent/types.js';
import type { SessionTurnStore } from '../persistence/session-turn-store.js';
import type { SkillActivation, SkillRegistry } from '../../skills/registry.js';

/** Receipts survive reconnects, but never cross provider-owned conversations. */
export class SkillCatalogDelivery {
  private initializedScope?: string;

  constructor(
    private store: SessionTurnStore,
    private sessionId: string,
    private agent: AgentSession,
  ) {}

  private scope() {
    if (!this.agent.id) return undefined;
    const session = this.store.session(this.sessionId);
    if (!session) return undefined;
    const identity = {
      sessionId: this.sessionId,
      providerId: session.selectedProvider,
      nativeSessionId: this.agent.id,
    };
    const key = JSON.stringify(identity);
    if (this.initializedScope !== key) {
      // Some providers reuse IDs. A genuinely fresh conversation knows nothing yet.
      if (this.agent.history === 'fresh') this.store.clearCatalog(identity);
      this.initializedScope = key;
    }
    return { identity };
  }

  compacted(compactionId: string): void {
    const scope = this.scope();
    if (!scope) return;
    const previous = this.store.catalog(scope.identity);
    // Replayed notifications for the last observed compaction do not invalidate twice.
    if (previous?.compactionId === compactionId) return;
    this.store.compactCatalog(scope.identity, compactionId);
  }

  prepare(registry: SkillRegistry, activation?: SkillActivation) {
    const scope = this.scope();
    const previous = scope ? this.store.catalog(scope.identity) : undefined;
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
        const current = this.store.catalog(scope.identity);
        // Compaction during this prompt may have discarded the catalog we just sent.
        if ((current?.compactionId ?? null) !== (previous?.compactionId ?? null)) return;
        this.store.deliverCatalog(scope.identity, catalogHash, previous?.compactionId ?? null);
      },
    };
  }
}
