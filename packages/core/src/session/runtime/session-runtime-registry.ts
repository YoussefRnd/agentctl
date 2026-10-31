import { RepositoryCheckpoints } from '../../repository/checkpoints.js';
import { decodeCustomModels } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import { sessions, mcpServers, providers } from '../../db/schema.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import {
  EMPTY_AGENT_FEATURES,
  findAgentConfigOption,
  normalizeReportedCost,
  type AgentFeatures,
  type SessionStatus,
  type ThinkingEffort,
} from '@agentctl/shared';
import { SessionStateProjector } from '../projection/session-state-projector.js';
import { SessionRuntime } from './session-runtime.js';
import type { DbClient } from '../../db/index.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { Logger } from '../../logger.js';
import { noopLogger } from '../../logger.js';
import type {
  AgentDriver,
  AgentSession,
  AgentSessionIntent,
  AgentUpdate,
} from '../../agent/types.js';
import { AgentAuthenticationRequiredError } from '../../agent/errors.js';
import type { SnapshotService } from '../../git/snapshot-service.js';
import type { SessionRepositoryResources } from '../contracts.js';
import type { RepositoryService } from '../../repository/repository-service.js';
import type { McpGateway } from '../../mcp/mcp-gateway.js';
import { DEFAULT_AGENT_MODEL } from '../../config/runtime-defaults.js';
import { jsonCodecs } from '../../db/json-codecs.js';

export interface SessionRecord {
  id: string;
  projectId: string;
  branch: string;
  worktreePath: string;
  taskSlug: string;
  title: string;
  baseCommit: string;
  agent: string;
  agentSessionId: string | null;
  selectedProvider: string;
  selectedModel: string;
  selectedThinkingEffort: ThinkingEffort;
  mode: 'local' | 'worktree';
  approvalMode: 'review' | 'auto_approve' | 'yolo';
  status: SessionStatus;
  totalTokens: number;
  contextLimit: number;
  estimatedCost: number;
  lastHeartbeat: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    name: string;
    path: string;
    repoRoot: string | null;
    subdir: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface LaunchContext {
  runtimeId?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
}

export class SessionRuntimeRegistry {
  private sessions = new Map<string, SessionRuntime>();
  private initializing = new Set<SessionRuntime>();
  private snapshotService: SnapshotService;
  private repositoryService: Pick<RepositoryService, 'open'>;

  constructor(
    private db: DbClient,
    private providerRegistry: ProviderRegistry,
    private eventRepository: SessionEventRepository,
    private logger: Logger = noopLogger,
    private runtime: AgentDriver,
    repositoryResources: SessionRepositoryResources,
    private mcpGateway?: McpGateway,
  ) {
    this.snapshotService = repositoryResources.legacySnapshots;
    this.repositoryService = repositoryResources.repositories;
  }

  ownsRuntime(sessionId: string, runtimeId: string): boolean {
    return this.sessions.get(sessionId)?.runtimeId === runtimeId;
  }

  getCheckpointService(): RepositoryCheckpoints {
    return new RepositoryCheckpoints(this.repositoryService);
  }

  getSnapshotService(): SnapshotService {
    return this.snapshotService;
  }

  getRepositoryService(): Pick<RepositoryService, 'open'> {
    return this.repositoryService;
  }

  getSession(sessionId: string): SessionRuntime | undefined {
    const session = this.sessions.get(sessionId);
    return session && !this.initializing.has(session) ? session : undefined;
  }

  hasSession(sessionId: string): boolean {
    return this.getSession(sessionId) !== undefined;
  }

  registerSession(sessionId: string, session: SessionRuntime, ready = true): void {
    const previous = this.sessions.get(sessionId);
    if (previous && previous !== session) {
      previous.kill();
      this.initializing.delete(previous);
    }
    if (!ready) this.initializing.add(session);
    this.sessions.set(sessionId, session);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.initializing.delete(session);
      this.sessions.delete(sessionId);
    }
  }

  async stopSessionAndWait(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.releaseSession(sessionId, session);
  }

  private async releaseSession(sessionId: string, session: SessionRuntime): Promise<void> {
    try {
      await session.stop();
    } finally {
      this.initializing.delete(session);
      if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
    }
  }

  clearSessions(): void {
    for (const session of this.sessions.values()) session.kill();
    this.sessions.clear();
    this.initializing.clear();
  }

  async stopAll(): Promise<void> {
    const stopping = [...this.sessions.entries()];
    const results = await Promise.allSettled(stopping.map(([, session]) => session.stop()));
    for (const [sessionId, session] of stopping) {
      this.initializing.delete(session);
      if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
    }
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Failed to stop sessions',
      );
  }

  async transitionTo(
    sessionId: string,
    targetState: SessionStatus,
    context?: LaunchContext,
  ): Promise<void> {
    if (context?.runtimeId && !this.ownsRuntime(sessionId, context.runtimeId)) return;
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (context?.runtimeId && !this.ownsRuntime(sessionId, context.runtimeId)) return;
    if (!sessionRecord) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const currentState = sessionRecord.status;
    if (currentState === targetState) {
      return;
    }

    this.validateTransition(currentState, targetState);

    this.logger.info(
      { sessionId, from: currentState, to: targetState },
      'Transitioning session state',
    );

    this.executeTransitionEffects(sessionRecord, currentState, targetState, context);

    const updateFields: Partial<typeof sessions.$inferInsert> = {
      status: targetState,
      updatedAt: new Date(),
    };

    if (targetState === 'archived' || targetState === 'idle') {
      updateFields.closedAt = new Date();
    }
    if (targetState === 'needs_attention') {
      updateFields.lastHeartbeat = new Date();
    }

    this.db.update(sessions).set(updateFields).where(eq(sessions.id, sessionId)).run();
  }

  private validateTransition(from: SessionStatus, to: SessionStatus) {
    if (from === 'merged' || from === 'discarded') {
      throw new Error(`Cannot transition from terminal state: ${from} to ${to}`);
    }

    const allowedTransitions: Record<SessionStatus, SessionStatus[]> = {
      idle: ['running', 'archived', 'merged', 'discarded', 'error'],
      running: ['idle', 'needs_attention', 'error'],
      needs_attention: ['running', 'idle', 'error'],
      error: ['idle', 'merged', 'discarded'],
      archived: ['idle'],
      merged: [],
      discarded: [],
    };

    if (!allowedTransitions[from].includes(to)) {
      throw new Error(`Invalid session state transition: ${from} -> ${to}`);
    }
  }

  private executeTransitionEffects(
    sessionRecord: SessionRecord,
    from: SessionStatus,
    to: SessionStatus,
    _context?: LaunchContext,
  ): void {
    const sessionId = sessionRecord.id;

    if (to === 'archived' || to === 'error' || to === 'merged' || to === 'discarded') {
      this.stopSession(sessionId);
    }
  }

  async startSession(
    sessionId: string,
    worktreePath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
    selectedModel = DEFAULT_AGENT_MODEL,
    selectedThinkingEffort: ThinkingEffort = null,
    features: AgentFeatures = EMPTY_AGENT_FEATURES,
    resolvedThinkingConfigId?: string,
    intent: AgentSessionIntent = { kind: 'new' },
    resolvedModelConfigId?: string,
  ): Promise<SessionRuntime> {
    const existingAgentSessionId = intent.kind === 'resume' ? intent.sessionId : undefined;
    this.logger.info(
      { sessionId, command, args, worktreePath, existingAgentSessionId },
      existingAgentSessionId
        ? 'Restoring existing provider session runtime'
        : 'Starting new provider session runtime',
    );

    let session: SessionRuntime | undefined;
    // Keep only the newest report while native startup/configuration is in progress.
    // Apply it through the installed runtime owner, never through an unfenced callback.
    let startupUsage: Extract<AgentUpdate, { type: 'usage_update' }> | undefined;
    let captureStartupUsage = true;
    let startupModel = selectedModel;
    let replayedCompactionId: string | undefined;
    let replayProjector =
      intent.kind === 'resume' && intent.requireExisting
        ? new SessionStateProjector(
            sessionId,
            this.db,
            this.eventRepository,
            this.logger,
            worktreePath,
          )
        : undefined;
    let providerId = 'default';

    try {
      const activeMcpConfigs = await this.db
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.enabled, true));

      const mcpServersPayload = activeMcpConfigs.map((row) => {
        if (row.type === 'remote') {
          const headersRecord = this.parseStringRecord(row.headers);
          const headersArray = Object.entries(headersRecord).map(([name, value]) => ({
            name,
            value,
          }));
          return {
            type: 'http' as const,
            name: row.name,
            url: row.url ?? '',
            headers: headersArray,
          };
        } else {
          const envRecord = this.parseStringRecord(row.launchEnv);
          const envArray = Object.entries(envRecord).map(([name, value]) => ({
            name,
            value,
          }));
          return {
            name: row.name,
            command: row.command ?? '',
            args: this.parseStringArray(row.launchArgs),
            env: envArray,
          };
        }
      });

      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });
      providerId = sessionRecord?.selectedProvider ?? 'default';
      const providerRecord = await this.db.query.providers.findFirst({
        where: eq(providers.id, providerId),
      });

      let startupConfigOptions: AgentSession['configOptions'];
      // A new native connection must report its own occupancy, including on resume.
      this.db
        .update(sessions)
        .set({
          contextUsedTokens: null,
          contextLimit: 0,
          sessionMetrics: JSON.stringify({
            ...jsonCodecs.unknownRecord(sessionRecord?.sessionMetrics),
            reportedCost: null,
          }),
        })
        .where(eq(sessions.id, sessionId))
        .run();
      const runtimeHandle = await this.runtime.startSession(
        command,
        args,
        {
          providerId,
          customModels: decodeCustomModels(providerRecord?.customModels),
          localSessionId: sessionId,
          cwd: worktreePath,
          env,
          selectedModel,
          selectedThinkingEffort,
          features,
          resolvedThinkingConfigId,
          resolvedModelConfigId,
          intent,
          mcpServers: mcpServersPayload,
          mcpGateway: this.mcpGateway,
        },
        {
          onUpdate: async (event) => {
            if (captureStartupUsage) {
              if (event.type === 'usage_update') {
                if (Number.isFinite(event.used) && Number.isFinite(event.size))
                  startupUsage = {
                    ...event,
                    cost: normalizeReportedCost(event.cost) ?? startupUsage?.cost,
                  };
                return;
              }
              if (event.type === 'context_compacted') startupUsage = undefined;
              if (event.type === 'config_option_update') {
                const model = findAgentConfigOption(event.configOptions, 'model')?.currentValue;
                if (typeof model === 'string' && model !== startupModel) {
                  startupUsage = undefined;
                  startupModel = model;
                }
              }
            }
            if (!session && event.type === 'context_compacted')
              replayedCompactionId = event.compactionId;
            if (replayProjector) {
              await replayProjector.handleDomainEvent(event);
            } else if (session && event.type !== 'user_text') {
              await session.handleDomainEvent(event);
            } else if (event.type === 'config_option_update') {
              startupConfigOptions = event.configOptions;
            }
          },
          onRequestPermission: async (req, signal) => {
            if (session) {
              return await session.handleRequestPermission(req, signal);
            }
            return { allowed: false };
          },
          onRequestElicitation: async (req, signal) => {
            if (session) {
              return await session.requestElicitation(req, signal);
            }
            return { action: 'cancel' };
          },
          onElicitationCompleted: (elicitationId) => {
            if (session) {
              session.cancelElicitation(elicitationId);
            }
          },
        },
      );

      session = new SessionRuntime(
        sessionId,
        runtimeHandle,
        this.db,
        this.eventRepository,
        worktreePath,
        this,
        this.logger,
        this.mcpGateway,
      );
      this.registerSession(sessionId, session, false);

      await replayProjector?.flushAll();
      replayProjector = undefined;
      if (replayedCompactionId && runtimeHandle.history === 'restored') {
        await session.handleDomainEvent({
          type: 'context_compacted',
          compactionId: replayedCompactionId,
        });
      }
      const liveConfigOptions = runtimeHandle.configOptions ?? startupConfigOptions;
      if (liveConfigOptions !== undefined) {
        await session.handleDomainEvent({
          type: 'config_option_update',
          configOptions: liveConfigOptions,
        });
      }

      if (sessionRecord?.agentPersona) {
        await session.setMode(sessionRecord.agentPersona);
      }

      let currentMapping: Record<string, string> = {};
      if (sessionRecord?.agentSessionId) {
        const decodedMapping = jsonCodecs.agentSessionMap(sessionRecord.agentSessionId);
        if (decodedMapping) {
          currentMapping = decodedMapping;
        } else {
          const initialProvider = sessionRecord.agent || sessionRecord.selectedProvider;
          if (initialProvider) {
            currentMapping[initialProvider] = sessionRecord.agentSessionId;
          }
        }
      }

      if (runtimeHandle.id) {
        currentMapping[providerId] = runtimeHandle.id;
      }

      const newAgentSessionIdValue = JSON.stringify(currentMapping);

      await this.db
        .update(sessions)
        .set({ agentSessionId: newAgentSessionIdValue, status: 'idle' })
        .where(eq(sessions.id, sessionId));
    } catch (err: unknown) {
      await replayProjector
        ?.flushAll()
        .catch((flushError: unknown) =>
          this.logger.error(flushError, 'Failed to flush interrupted session replay'),
        );
      replayProjector = undefined;
      if (err instanceof AgentAuthenticationRequiredError) {
        startupUsage = undefined;
        this.logger.warn(`Session ${sessionId} requires authentication`);
        this.providerRegistry
          .getAuthCoordinator()
          .markAuthRequired(providerId, { message: 'Authentication required' });

        await this.db
          .update(sessions)
          .set({ status: 'needs_attention' })
          .where(eq(sessions.id, sessionId));

        await this.eventRepository.append(sessionId, 'status', {
          status: 'needs_auth',
          message: 'Authentication required. Open the provider authentication dialog to continue.',
        });

        const runtimeHandle: AgentSession = err.pendingSession;

        session = new SessionRuntime(
          sessionId,
          runtimeHandle,
          this.db,
          this.eventRepository,
          worktreePath,
          this,
          this.logger,
          this.mcpGateway,
        );
        this.registerSession(sessionId, session, false);
      } else {
        if (session) {
          await this.releaseSession(sessionId, session).catch((cleanupError: unknown) =>
            this.logger.error(cleanupError, 'Failed to clean up session startup'),
          );
        }
        throw err;
      }
    }

    try {
      await session.recordRuntimeBinding(features);
      while (startupUsage) {
        const report = startupUsage;
        startupUsage = undefined;
        await session.handleDomainEvent(report);
      }
      captureStartupUsage = false;
      if (session.isDead || !this.ownsRuntime(sessionId, session.runtimeId))
        throw new Error('Session runtime was retired during startup');
      this.initializing.delete(session);
    } catch (error) {
      await this.releaseSession(sessionId, session).catch((cleanupError: unknown) =>
        this.logger.error(cleanupError, 'Failed to clean up runtime binding'),
      );
      throw error;
    }
    return session;
  }

  private parseStringArray(value: string | null | undefined): string[] {
    return jsonCodecs.stringArray(value);
  }

  private parseStringRecord(value: string | null | undefined): Record<string, string> {
    return jsonCodecs.stringRecord(value);
  }
}
