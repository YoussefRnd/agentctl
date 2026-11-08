import type { SessionStatus } from '@agentctl/shared';
import type { DbClient } from '../../db/index.js';
import { prepareTurnStatements, type CatalogIdentity } from './session-turn-statements.js';

/** One runtime's connection-bound statements, shared by dispatch, turn and skill workflows. */
export class SessionTurnStore {
  private prepared?: ReturnType<typeof prepareTurnStatements>;
  private get statements() {
    return (this.prepared ??= prepareTurnStatements(this.db));
  }
  constructor(private db: DbClient) {}

  session(sessionId: string) {
    return this.statements.session.get({ sessionId });
  }
  providerLoadsSkills(providerId: string): boolean {
    return this.statements.provider.get({ providerId })?.nativelyLoadsSkills ?? false;
  }
  setSessionStatus(sessionId: string, status: SessionStatus): void {
    this.statements.status.run({ sessionId, status, now: new Date() });
  }
  finishAttempt(attemptId: string, status: 'completed' | 'failed' | 'cancelled'): void {
    this.statements.finish.run({ attemptId, status, now: new Date() });
  }
  markDispatched(attemptId: string): boolean {
    return this.statements.dispatch.get({ attemptId, now: new Date() }) !== undefined;
  }
  catalog(identity: CatalogIdentity) {
    return this.statements.catalog.get(identity);
  }
  clearCatalog(identity: CatalogIdentity): void {
    this.statements.clearCatalog.run(identity);
  }
  compactCatalog(identity: CatalogIdentity, compactionId: string): void {
    this.statements.compactCatalog.run({ ...identity, compactionId });
  }
  deliverCatalog(
    identity: CatalogIdentity,
    catalogHash: string,
    compactionId: string | null,
  ): void {
    this.statements.deliverCatalog.run({ ...identity, catalogHash, compactionId });
  }
}
