import { decodeCustomModels } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import { sessions, mcpServers, providers } from '../../db/schema.js';
import type { WorkspaceManager } from '../../git/worktree-manager.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import {
  EMPTY_AGENT_FEATURES,
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
import type { AgentDriver, AgentSession, AgentSessionIntent } from '../../agent/types.js';
import { AgentAuthenticationRequiredError } from '../../agent/errors.js';
import { SnapshotService } from '../../git/snapshot-service.js';
import type { McpGateway } from '../../mcp/mcp-gateway.js';
import { DEFAULT_AGENT_MODEL, DEFAULT_THINKING_EFFORT } from '../../config/runtime-defaults.js';
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
  selectedThinkingEffort: string;
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
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
}

export class SessionRuntimeRegistry {
  private sessions = new Map<string, SessionRuntime>();
  private snapshotService: SnapshotService;

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    private eventRepository: SessionEventRepository,
    private logger: Logger = noopLogger,
    private runtime: AgentDriver,
    private mcpGateway?: McpGateway,
  ) {
    this.snapshotService = new SnapshotService();
  }

  ownsRuntime(sessionId: string, runtimeId: string): boolean {
    const current = this.sessions.get(sessionId);
    return !current || current.runtimeId === runtimeId;
  }

  getSnapshotService(): SnapshotService {
    return this.snapshotService;
  }

  getSession(sessionId: string): SessionRuntime | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  registerSession(sessionId: string, session: SessionRuntime): void {
    this.sessions.set(sessionId, session);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
  }

  async stopSessionAndWait(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.sessions.delete(sessionId);
    await session.stop();
  }

  clearSessions(): void {
    this.sessions.clear();
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.sessions.values()).map((session) => session.stop());
    await Promise.all(stopPromises);
    this.sessions.clear();
  }

  async transitionTo(
    sessionId: string,
    targetState: SessionStatus,
    context?: LaunchContext,
  ): Promise<void> {
    const sessionRecord = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

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

    await this.executeTransitionEffects(sessionRecord, currentState, targetState, context);

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

    await this.db.update(sessions).set(updateFields).where(eq(sessions.id, sessionId));
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
  ): Promise<void> {
    const sessionId = sessionRecord.id;

    if (to === 'archived' || to === 'error' || to === 'merged' || to === 'discarded') {
      this.stopSession(sessionId);
    }
    return Promise.resolve();
  }

  async startSession(
    sessionId: string,
    worktreePath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
    selectedModel = DEFAULT_AGENT_MODEL,
    selectedThinkingEffort: ThinkingEffort = DEFAULT_THINKING_EFFORT,
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

      await replayProjector?.flushAll();
      replayProjector = undefined;
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
      await replayProjector?.flushAll();
      replayProjector = undefined;
      if (err instanceof AgentAuthenticationRequiredError) {
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
      } else {
        throw err;
      }
    }

    await session.recordRuntimeBinding(features);
    this.sessions.set(sessionId, session);
    return session;
  }

  private parseStringArray(value: string | null | undefined): string[] {
    return jsonCodecs.stringArray(value);
  }

  private parseStringRecord(value: string | null | undefined): Record<string, string> {
    return jsonCodecs.stringRecord(value);
  }
}
