import { RequestCancellation } from '../requests/request-cancellation.js';
import { randomUUID } from 'node:crypto';
import { SessionTurnExecutor } from '../execution/session-turn-executor.js';
import { sessions, sessionTurnAttempts, sessionRuntimeBindings } from '../../db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbClient } from '../../db/index.js';
import { type Logger, noopLogger } from '../../logger.js';
import type { SessionEventRepositoryLike, SessionStatusTransitioner } from '../contracts.js';
import type {
  AgentMcpGateway,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSession,
  AgentUpdate,
} from '../../agent/types.js';

import { SessionStateProjector } from '../projection/session-state-projector.js';
import { ElicitationRegistry } from '../requests/elicitation-registry.js';
import { SessionPermissionController } from '../requests/session-permission-controller.js';

import {
  type AgentConfigOption,
  type AgentFeatures,
  EMPTY_AGENT_FEATURES,
  type ElicitationRequest,
  type ElicitationResponse,
} from '@agentctl/shared';

export class SessionRuntime {
  readonly runtimeId = randomUUID();
  private activeAttemptId: string | undefined;
  get nativeSessionId(): string | null {
    return this.runtimeHandle.id;
  }
  public elicitationRegistry = new ElicitationRegistry();
  private permissions: SessionPermissionController;
  get permissionEngine() {
    return this.permissions.engine;
  }
  private isStopped = false;
  private stopKind: 'idle' | 'error' | null = null;
  private needsHistoryContext = false;

  private projector: SessionStateProjector;
  private turnExecutor: SessionTurnExecutor;

  async recordRuntimeBinding(features: AgentFeatures = EMPTY_AGENT_FEATURES): Promise<void> {
    if (this.isStopped) throw new Error('Session runtime is closed');
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, this.sessionId) });
    if (!row) throw new Error('Session is unavailable');
    const binding = {
      sessionId: this.sessionId,
      providerId: row.selectedProvider,
      nativeSessionId: this.nativeSessionId,
      connectionState: 'connected' as const,
      capabilities: JSON.stringify({
        features,
        configOptions: this.runtimeHandle.configOptions ?? [],
        availableModes: this.runtimeHandle.availableModes ?? [],
      }),
    };
    await this.db
      .insert(sessionRuntimeBindings)
      .values({ id: this.runtimeId, ...binding })
      .onConflictDoUpdate({ target: sessionRuntimeBindings.id, set: binding });
  }

  async bindAttempt(attemptId: string): Promise<void> {
    if (this.isStopped) throw new Error('Session runtime is closed');
    const row = await this.db.query.sessions.findFirst({ where: eq(sessions.id, this.sessionId) });
    if (!row) throw new Error('Session is unavailable');
    await this.db
      .update(sessionRuntimeBindings)
      .set({ nativeSessionId: this.nativeSessionId })
      .where(eq(sessionRuntimeBindings.id, this.runtimeId));
    await this.db
      .update(sessionTurnAttempts)
      .set({
        runtimeId: this.runtimeId,
        providerId: row.selectedProvider,
        nativeSessionId: this.nativeSessionId,
      })
      .where(eq(sessionTurnAttempts.id, attemptId));
  }

  private async markAttemptDispatched(): Promise<void> {
    if (this.isStopped) throw new Error('Session runtime is closed');
    if (this.activeAttemptId)
      await this.db
        .update(sessionTurnAttempts)
        .set({ dispatchedAt: new Date() })
        .where(
          and(
            eq(sessionTurnAttempts.id, this.activeAttemptId),
            inArray(sessionTurnAttempts.status, ['running', 'waiting']),
          ),
        );
  }

  private async closeBinding(connectionState: 'closed' | 'lost'): Promise<void> {
    await this.db
      .update(sessionRuntimeBindings)
      .set({ connectionState })
      .where(eq(sessionRuntimeBindings.id, this.runtimeId));
  }

  public async flushAll(): Promise<void> {
    await this.projector.flushAll();
  }

  /** Full-content snapshots of in-flight streaming events (SSE resync). */
  public getLiveEventSnapshots(): ReturnType<SessionStateProjector['getTransientSnapshots']> {
    return this.projector.getTransientSnapshots();
  }

  get isDead(): boolean {
    return this.isStopped;
  }

  get requiresHistoryContext(): boolean {
    return this.needsHistoryContext;
  }

  markHistoryContextTransferred(): void {
    this.needsHistoryContext = false;
  }

  constructor(
    public sessionId: string,
    private runtimeHandle: AgentSession,
    private db: DbClient,
    public eventRepository: SessionEventRepositoryLike,
    private cwd: string,
    private runtimeRegistry?: SessionStatusTransitioner,
    private logger: Logger = noopLogger,
    mcpGateway?: AgentMcpGateway,
  ) {
    this.needsHistoryContext = runtimeHandle.history === 'fresh';
    this.projector = new SessionStateProjector(
      sessionId,
      db,
      eventRepository,
      logger,
      cwd,
      runtimeRegistry?.getSnapshotService?.(),
    );

    this.permissions = new SessionPermissionController(
      sessionId,
      db,
      eventRepository,
      cwd,
      {
        isStopped: () => this.isStopped,
        activeAttemptId: () => this.activeAttemptId,
        parentEventId: (subagentId) => this.projector.subagents.parentFor(subagentId),
        closed: runtimeHandle.closed,
        onError: (error) => this.handleError(error),
      },
      runtimeRegistry,
    );

    this.turnExecutor = new SessionTurnExecutor(
      sessionId,
      runtimeHandle,
      db,
      eventRepository,
      cwd,
      this.projector,
      this.permissionEngine,
      logger,
      {
        runtimeId: this.runtimeId,
        isStopped: () => this.isStopped,
        beginAttempt: (attemptId) => {
          this.activeAttemptId = attemptId;
        },
        endAttempt: () => {
          this.activeAttemptId = undefined;
        },
        markDispatched: () => this.markAttemptDispatched(),
        onError: (error) => this.handleError(error),
      },
      runtimeRegistry,
      mcpGateway,
    );

    // Persist available agent personas from initialization
    if (runtimeHandle.availableModes && runtimeHandle.availableModes.length > 0) {
      void this.db
        .update(sessions)
        .set({
          availableAgentPersonas: JSON.stringify(runtimeHandle.availableModes),
        })
        .where(eq(sessions.id, sessionId))
        .catch((err: unknown) => {
          this.logger.error(err, 'Failed to update availableAgentPersonas on init');
        });
    }

    this.runtimeHandle.onError((err) => {
      this.logger.error(err, `Child process error in session ${this.sessionId}`);
      this.rejectPendingApprovals();
      void this.handleError(err).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error');
      });
    });

    this.runtimeHandle.onClose((detail) => {
      this.rejectPendingApprovals();
      if (this.stopKind === 'error' || this.isStopped) return;
      if (detail?.code != null && detail.code !== 0) {
        void this.handleError(
          new Error(detail.message ?? `Agent exited with code ${detail.code}`),
        ).catch((error: unknown) => this.logger.error(error, 'Failed to record agent exit'));
        return;
      }

      this.elicitationRegistry.clear();
      void this.closeBinding('closed').catch((error: unknown) =>
        this.logger.error(error, 'Failed to close runtime binding'),
      );
      void this.markSessionStopped('idle').catch((e: unknown) => {
        this.logger.error(e, 'Failed to update session status on exit');
      });
    });

    void this.runtimeHandle.closed
      .then(() => {
        this.rejectPendingApprovals();
        if (this.stopKind === 'error' || this.isStopped) return;

        this.isStopped = true;
        this.elicitationRegistry.clear();
        void this.closeBinding('closed').catch((error: unknown) =>
          this.logger.error(error, 'Failed to close runtime binding'),
        );
        void this.markSessionStopped('idle').catch((e: unknown) => {
          this.logger.error(e, 'Failed to update session status on close');
        });
      })
      .catch(async (error: unknown) => {
        this.rejectPendingApprovals();
        if (this.isStopped) return;
        this.logger.error(error, 'Connection closed with error');
        await this.handleError(error);
      });
  }

  private rejectPendingApprovals(): void {
    this.permissions.clearPending();
  }

  writeTerminalInput(terminalId: string, data: string): boolean {
    if (this.runtimeHandle.writeTerminalInput) {
      return this.runtimeHandle.writeTerminalInput(terminalId, data);
    }
    return false;
  }

  prompt(...args: Parameters<SessionTurnExecutor['execute']>): Promise<void> {
    return this.turnExecutor.execute(...args);
  }

  resolvePermission(permissionId: string, response: AgentPermissionResponse): void {
    this.permissions.resolvePermission(permissionId, response);
  }

  handleRequestPermission(
    request: AgentPermissionRequest,
    signal?: AbortSignal,
  ): Promise<AgentPermissionResponse> {
    return this.permissions.handleRequestPermission(request, signal);
  }

  async requestElicitation(
    request: ElicitationRequest,
    signal?: AbortSignal,
  ): Promise<ElicitationResponse> {
    if (this.isStopped || signal?.aborted) return { action: 'cancel' };
    const cancellation = new RequestCancellation(signal);
    const epoch = this.permissions.epoch;
    const { item, promise } = this.elicitationRegistry.createElicitation(request);

    try {
      await this.eventRepository.append(
        this.sessionId,
        'status',
        {
          status: 'elicitation_requested',
          request,
          elicitation: item,
        },
        this.projector.subagents.parentFor(request.subagentId),
        request.subagentId ? { nativeSessionId: request.subagentId } : undefined,
      );

      if (this.isStopped || this.permissions.epoch !== epoch || cancellation.aborted)
        this.cancelElicitation(request.id);
      const response = await Promise.race([
        promise,
        cancellation.cancelled.then(() => ({ action: 'cancel' as const })),
      ]);
      if (cancellation.aborted) this.cancelElicitation(request.id);
      return response;
    } finally {
      cancellation.dispose();
    }
  }

  respondToElicitation(elicitationId: string, response: ElicitationResponse): boolean {
    const ok = this.elicitationRegistry.respondToElicitation(elicitationId, response);
    if (ok) {
      void this.eventRepository.append(
        this.sessionId,
        'status',
        {
          status: 'elicitation_responded',
          elicitationId,
          response,
        },
        null,
      );
    }
    return ok;
  }

  cancelElicitation(elicitationId: string): boolean {
    return this.respondToElicitation(elicitationId, { action: 'cancel' });
  }

  kill(connectionState: 'closed' | 'lost' = 'closed'): void {
    if (this.isStopped) return;

    this.isStopped = true;
    this.rejectPendingApprovals();
    this.permissionEngine.clear();
    this.elicitationRegistry.clear();
    void this.closeBinding(connectionState).catch((error: unknown) =>
      this.logger.error(error, 'Failed to close runtime binding'),
    );

    void this.flushAll().catch((err: unknown) => {
      this.logger.error(err, 'Failed to flush buffers in kill()');
    });

    void this.runtimeHandle
      .close()
      .catch((error: unknown) => this.logger.error(error, 'Failed to close session runtime'));
  }

  async authenticate(methodId: string): Promise<void> {
    await this.runtimeHandle.authenticate(methodId);
  }

  async cancel(): Promise<void> {
    this.rejectPendingApprovals();
    if (this.activeAttemptId)
      await this.db
        .update(sessionTurnAttempts)
        .set({ status: 'cancelled', endedAt: new Date() })
        .where(
          and(
            eq(sessionTurnAttempts.id, this.activeAttemptId),
            inArray(sessionTurnAttempts.status, ['running', 'waiting']),
          ),
        );

    this.elicitationRegistry.clear();
    try {
      await this.runtimeHandle.cancel();
    } finally {
      await this.flushAll();
    }
  }

  async stop(): Promise<void> {
    await this.flushAll();
    if (!this.isStopped) {
      this.isStopped = true;
      this.rejectPendingApprovals();
      this.permissionEngine.clear();
      this.elicitationRegistry.clear();
      await this.runtimeHandle.close();
    }
    await this.closeBinding(this.stopKind === 'error' ? 'lost' : 'closed');
    await this.markSessionStopped('idle');
  }

  async updateModel(modelId: string): Promise<AgentConfigOption[] | void> {
    if (this.isStopped || typeof this.runtimeHandle.updateModel !== 'function') return;
    const configOptions = await this.runtimeHandle.updateModel(modelId);
    if (configOptions !== undefined) {
      await this.handleDomainEvent({ type: 'config_option_update', configOptions });
    }
    return configOptions;
  }

  async updateConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<AgentConfigOption[] | void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.updateConfigOption === 'function') {
      try {
        const configOptions = await this.runtimeHandle.updateConfigOption(configId, value);
        await this.handleDomainEvent({ type: 'config_option_update', configOptions });
        return configOptions;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(err, `Failed to update config option ${configId} to ${String(value)}`);
        await this.eventRepository.append(
          this.sessionId,
          'status',
          {
            status: 'config_option_error',
            configId,
            value,
            error: errorMessage,
          },
          null,
        );
        throw err;
      }
    }
  }

  async setMode(modeId: string): Promise<void> {
    if (this.isStopped) return;
    if (typeof this.runtimeHandle.setMode === 'function') {
      await this.runtimeHandle.setMode(modeId);
    }
  }

  private async handleError(error: unknown): Promise<void> {
    if (
      this.stopKind === 'error' ||
      (this.runtimeRegistry?.ownsRuntime &&
        !this.runtimeRegistry.ownsRuntime(this.sessionId, this.runtimeId))
    )
      return;
    this.logger.error(error, `Error in session runtime ${this.sessionId}`);
    this.stopKind = 'error';
    await this.eventRepository.append(
      this.sessionId,
      'status',
      {
        status: 'runtime_error',
        title: (error instanceof Error ? error.message : String(error)).slice(0, 5000),
      },
      null,
    );
    await this.flushAll();
    await this.projector.finalizeInFlightToolCalls('interrupted');
    this.kill('lost');
    await this.markSessionStopped('error');
  }

  private async markSessionStopped(status: 'idle' | 'error'): Promise<void> {
    this.stopKind = status;
    if (
      this.runtimeRegistry?.ownsRuntime &&
      !this.runtimeRegistry.ownsRuntime(this.sessionId, this.runtimeId)
    )
      return;
    if (this.runtimeRegistry) {
      await this.runtimeRegistry.transitionTo(this.sessionId, status);
    } else {
      if (status === 'idle') {
        await this.db
          .update(sessions)
          .set({ status: 'idle', closedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      } else {
        await this.db
          .update(sessions)
          .set({ status: 'error', updatedAt: new Date() })
          .where(eq(sessions.id, this.sessionId));
      }
    }
  }

  public async handleDomainEvent(event: AgentUpdate): Promise<void> {
    if (
      this.isStopped ||
      (this.runtimeRegistry?.ownsRuntime &&
        !this.runtimeRegistry.ownsRuntime(this.sessionId, this.runtimeId))
    )
      return;
    if (
      event.type === 'status' &&
      this.activeAttemptId &&
      ['running', 'requires_action'].includes(event.status)
    ) {
      await this.db
        .update(sessionTurnAttempts)
        .set({ status: event.status === 'requires_action' ? 'waiting' : 'running' })
        .where(
          and(
            eq(sessionTurnAttempts.id, this.activeAttemptId),
            inArray(sessionTurnAttempts.status, ['running', 'waiting']),
          ),
        );
    }
    try {
      await this.turnExecutor.observeUpdate(event).catch((error: unknown) => {
        this.logger.error(error, 'Failed to record turn diagnostics');
      });
      await this.projector.handleDomainEvent(event);
    } catch (error) {
      await this.handleError(error).catch((e: unknown) => {
        this.logger.error(e, 'Failed to handle error in handleDomainEvent');
      });
      throw error;
    }
  }
}
