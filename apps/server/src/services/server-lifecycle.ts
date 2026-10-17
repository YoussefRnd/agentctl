import { inArray } from 'drizzle-orm';
import { sessions, type DbClient } from '@agentctl/core/db';
import type { ProviderRegistry } from '@agentctl/core/providers';
import type { SessionManager } from '@agentctl/core/session';
import type { McpGateway } from '@agentctl/core/mcp';
import type { FastifyBaseLogger } from 'fastify';
import type { EventBus } from '../utils/event-bus.js';
import type { InteractiveTerminalService } from './terminal-service.js';

export interface ServerLifecycleDependencies {
  db: DbClient;
  providers: ProviderRegistry;
  sessions: SessionManager;
  gateway: McpGateway;
  terminals: InteractiveTerminalService;
  events: EventBus;
  log: FastifyBaseLogger;
}

/** One owner for recovery, background refresh, and awaited application shutdown. */
export class ServerLifecycle {
  private providerUpdateRun?: Promise<void>;
  private providerUpdateInterval?: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
  private closing = false;
  constructor(private readonly deps: ServerLifecycleDependencies) {}
  async recover(): Promise<void> {
    this.deps.providers.setOnStateChange(() => {
      this.deps.events.publishState({ topics: ['providers'] });
    });

    this.deps.providers.getAuthCoordinator().setCredentialChangeHandler(async (providerIds) => {
      const affected = await this.deps.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(inArray(sessions.selectedProvider, providerIds));
      await Promise.all(
        affected.map((session) => this.deps.sessions.stopSessionAndWait(session.id)),
      );
    });

    await this.deps.providers.recoverInterruptedOperations();
    await this.deps.sessions.recoverInterruptedOperations?.();
  }
  startUpdates(): void {
    if (this.providerUpdateInterval || this.closing) return;
    // Refresh the catalog and update installed providers at startup and once per day.
    const refreshAndUpdateProviders = (): Promise<void> => {
      if (this.closing) return Promise.resolve();
      if (this.providerUpdateRun) return this.providerUpdateRun;
      const run = (async () => {
        await this.deps.providers.sync();
        if (this.closing) return;
        await this.deps.providers.autoUpdateInstalledProviders();
      })();
      this.providerUpdateRun = run;
      void run
        .finally(() => {
          if (this.providerUpdateRun === run) this.providerUpdateRun = undefined;
        })
        .catch(() => undefined);
      return run;
    };

    void refreshAndUpdateProviders()
      .then(async () => {
        if (this.closing) return;
        await this.deps.providers.probeAllInstalledProviders();
        if (!this.closing) this.deps.events.publishState({ topics: ['providers'] });
      })
      .catch((err: unknown) => {
        if (!this.closing) this.deps.log.error(err, 'Failed to refresh providers on startup');
      });

    this.providerUpdateInterval = setInterval(
      () => {
        void refreshAndUpdateProviders().catch((err: unknown) => {
          if (!this.closing)
            this.deps.log.error(err, 'Failed to refresh providers in the background');
        });
      },
      24 * 60 * 60 * 1000,
    );
    this.providerUpdateInterval.unref();
  }
  async startGateway(): Promise<void> {
    try {
      await this.deps.gateway.start();
    } catch (error) {
      this.deps.log.error(error, 'Failed to start MCP Gateway');
    }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.closing = true;
    clearInterval(this.providerUpdateInterval);
    this.stopping = (async () => {
      const errors: unknown[] = [];
      for (const close of [
        () => this.deps.sessions.stopAll(),
        () => this.deps.providers.dispose(),
        () => this.deps.terminals.closeAll(),
        () => this.deps.gateway.stop(),
      ]) {
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Failed to close server resources');
    })();
    return this.stopping;
  }
}
