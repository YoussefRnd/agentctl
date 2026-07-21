import { eq } from 'drizzle-orm';
import { sessions, mcpServers } from '../db/schema.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { ProviderRegistry } from './acp-provider-registry.js';
import type { SessionStatus, ThinkingEffort } from '@agentctl/shared';
import { ACPSession, type DbClient } from './acp-session.js';
import type { SessionEventStore } from './session-event-store.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import type { AgentRuntime, AgentRuntimeHandle } from './acp-transport.js';
import { AuthRequiredError } from './acp-transport.js';
import { SnapshotService } from '../git/snapshot-service.js';
import type { McpGateway } from './mcp-gateway.js';

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
  supportsDynamicModel?: boolean;
  supportsDynamicConfig?: boolean;
  resolvedThinkingConfigId?: string;
  resolvedModelConfigId?: string;
}

export class SessionStateMachine {
  private sessions = new Map<string, ACPSession>();
  private snapshotService: SnapshotService;

  constructor(
    private db: DbClient,
    private workspaceManager: WorkspaceManager,
    private providerRegistry: ProviderRegistry,
    private eventStore: SessionEventStore,
    private logger: Logger = noopLogger,
    private runtime: AgentRuntime,
    private mcpGateway?: McpGateway,
  ) {
    this.snapshotService = new SnapshotService();
  }

  getSnapshotService(): SnapshotService {
    return this.snapshotService;
  }

  getSession(sessionId: string): ACPSession | undefined {
    return this.sessions.get(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  registerSession(sessionId: string, session: ACPSession): void {
    this.sessions.set(sessionId, session);
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill();
      this.sessions.delete(sessionId);
    }
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
    selectedModel = 'default',
    selectedThinkingEffort: ThinkingEffort = 'medium',
    supportsDynamicModel = false,
    supportsDynamicConfig = false,
    resolvedThinkingConfigId?: string,
    existingAgentSessionId?: string | null,
    resolvedModelConfigId?: string,
  ): Promise<ACPSession> {
    this.logger.info(
      { sessionId, command, args, worktreePath, existingAgentSessionId },
      'Starting new agent session via state machine',
    );

    let session: ACPSession | undefined;

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
            type: 'sse' as const,
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

      const runtimeHandle = await this.runtime.execute(
        command,
        args,
        {
          cwd: worktreePath,
          env,
          selectedModel,
          selectedThinkingEffort,
          supportsDynamicModel,
          supportsDynamicConfig,
          resolvedThinkingConfigId,
          resolvedModelConfigId,
          existingAgentSessionId,
          mcpServers: mcpServersPayload,
          mcpGateway: this.mcpGateway,
        },
        {
          onEvent: async (event) => {
            if (session) {
              await session.handleDomainEvent(event);
            }
          },
          onRequestPermission: async (req) => {
            if (session) {
              return await session.handleRequestPermission(req);
            }
            return { allowed: false };
          },
          onRequestElicitation: async (req) => {
            if (session) {
              return await session.requestElicitation(req);
            }
            return { action: 'cancel' };
          },
        },
      );

      session = new ACPSession(
        sessionId,
        runtimeHandle,
        this.db,
        this.eventStore,
        worktreePath,
        this,
        this.logger,
        this.mcpGateway,
      );

      // Synchronize initial mode from DB
      const sessionRecord = await this.db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });
      if (sessionRecord?.agentPersona) {
        await session.setMode(sessionRecord.agentPersona);
      }

      const providerId = sessionRecord?.selectedProvider ?? 'default';
      let currentMapping: Record<string, string> = {};
      if (sessionRecord?.agentSessionId) {
        try {
          const parsed = JSON.parse(sessionRecord.agentSessionId) as unknown;
          if (parsed && typeof parsed === 'object') {
            currentMapping = parsed as Record<string, string>;
          }
        } catch {
          if (sessionRecord.selectedProvider) {
            currentMapping[sessionRecord.selectedProvider] = sessionRecord.agentSessionId;
          }
        }
      }

      if (runtimeHandle.acpSessionId) {
        currentMapping[providerId] = runtimeHandle.acpSessionId;
      }

      const newAgentSessionIdValue = JSON.stringify(currentMapping);

      await this.db
        .update(sessions)
        .set({ agentSessionId: newAgentSessionIdValue, status: 'idle' })
        .where(eq(sessions.id, sessionId));
    } catch (err: unknown) {
      if (err instanceof AuthRequiredError) {
        this.logger.warn(`Session ${sessionId} requires authentication`);
        await this.db
          .update(sessions)
          .set({ status: 'needs_attention' })
          .where(eq(sessions.id, sessionId));

        await this.eventStore.append(sessionId, 'status', {
          status: 'needs_auth',
          message: 'Authentication required. Please check your API keys or log in via CLI.',
        });

        const runtimeHandle: AgentRuntimeHandle = {
          acpSessionId: null,
          closed: err.connection.closed,
          onProcessError(handler) {
            err.child.on('error', handler);
          },
          onProcessExit(handler) {
            err.child.once('exit', handler);
          },
          prompt: (_text: string, _attachments?: unknown[], _embedded?: string) =>
            Promise.resolve({ stopReason: 'end_turn' }),
          authenticate: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          stop(): Promise<void> {
            err.child.kill();
            return Promise.resolve();
          },
        };

        session = new ACPSession(
          sessionId,
          runtimeHandle,
          this.db,
          this.eventStore,
          worktreePath,
          this,
          this.logger,
          this.mcpGateway,
        );
      } else {
        throw err;
      }
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  private parseStringArray(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
      return JSON.parse(value) as string[];
    } catch {
      return [];
    }
  }

  private parseStringRecord(value: string | null | undefined): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
