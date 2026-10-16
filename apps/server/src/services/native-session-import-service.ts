import { and, eq } from 'drizzle-orm';
import { sessions, sessionEvents, nativeSessionImports, type DbClient } from '@agentctl/core/db';
import type { SessionManager } from '@agentctl/core/session';
import type { ProviderRegistry } from '@agentctl/core/providers';
import { AppError } from '../errors/app-error.js';
import type { SessionCommands } from './session-commands.js';

/** Deduplicates native imports and owns interrupted-import cleanup and recovery. */
export class NativeSessionImportService {
  constructor(
    private readonly db: DbClient,
    private readonly sessionManager: Pick<SessionManager, 'stopSessionAndWait' | 'restartSession'>,
    private readonly providerRegistry: Pick<ProviderRegistry, 'ensureProviderReady'>,
    private readonly create: SessionCommands['createSession'],
  ) {}

  private nativeImports = new Map<string, Promise<{ sessionId: string }>>();

  importNativeSession(params: {
    projectId: string;
    providerId: string;
    nativeSessionId: string;
    title?: string;
  }): Promise<{ sessionId: string }> {
    const key = JSON.stringify([params.projectId, params.providerId, params.nativeSessionId]);
    const pending = this.nativeImports.get(key);
    if (pending) return pending;
    const operation = this.doImportNativeSession(params);
    this.nativeImports.set(key, operation);
    void operation.finally(() => this.nativeImports.delete(key)).catch(() => undefined);
    return operation;
  }

  private async doImportNativeSession(params: {
    projectId: string;
    providerId: string;
    nativeSessionId: string;
    title?: string;
  }): Promise<{ sessionId: string }> {
    const identity = and(
      eq(nativeSessionImports.projectId, params.projectId),
      eq(nativeSessionImports.providerId, params.providerId),
      eq(nativeSessionImports.nativeSessionId, params.nativeSessionId),
    );
    let imported = this.db.select().from(nativeSessionImports).where(identity).get();
    if (imported?.completed) return { sessionId: imported.sessionId };
    const provider = await this.providerRegistry.ensureProviderReady(params.providerId);
    if (!provider.features.sessions.resume)
      throw new AppError('Agent does not support native session loading', 400);
    if (!imported) {
      const created = await this.create({
        projectId: params.projectId,
        providerId: params.providerId,
        taskSlug: 'imported-session',
        mode: 'local',
      });
      this.db.transaction((tx) => {
        tx.update(sessions)
          .set({
            agentSessionId: JSON.stringify({ [params.providerId]: params.nativeSessionId }),
            title: params.title?.trim() || 'Imported session',
          })
          .where(eq(sessions.id, created.id))
          .run();
        tx.insert(nativeSessionImports)
          .values({ ...params, sessionId: created.id })
          .run();
      });
      imported = this.db.select().from(nativeSessionImports).where(identity).get()!;
    }
    try {
      await this.sessionManager.stopSessionAndWait(imported.sessionId);
      // A previous interrupted load can be retried without duplicating partial history.
      this.db.transaction((tx) => {
        tx.delete(sessionEvents).where(eq(sessionEvents.sessionId, imported.sessionId)).run();
        tx.update(sessions)
          .set({ plan: '[]', planArtifacts: '[]' })
          .where(eq(sessions.id, imported.sessionId))
          .run();
      });
      const loaded = await this.sessionManager.restartSession(imported.sessionId, {
        nativeImport: true,
      });
      await loaded.flushAll();
      if (loaded.isDead || loaded.requiresHistoryContext)
        throw new AppError('The native session could not be restored', 400);
      this.db.update(nativeSessionImports).set({ completed: true }).where(identity).run();
      return { sessionId: imported.sessionId };
    } catch (error) {
      await this.sessionManager.stopSessionAndWait(imported.sessionId);
      this.db
        .update(sessions)
        .set({ status: 'error' })
        .where(eq(sessions.id, imported.sessionId))
        .run();
      throw error;
    }
  }
}
