import { composeSessionResources } from './composition/session-resources.js';
import type { IEventBus } from './contracts.js';
import { composeSessionWorkflows } from './composition/session-workflows.js';
import { eq } from 'drizzle-orm';
import { projects } from '../db/schema.js';
import type { SessionRuntime } from './runtime/session-runtime.js';
import type { DbClient } from '../db/index.js';
import type { AgentDriver, AgentSessionIntent } from '../agent/types.js';
import type { AgentRuntimeServices } from '../agent/runtime-services.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import type { SessionEventRepository } from './persistence/session-event-repository.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import type { SessionWorkspace } from '../git/session-workspace.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import {
  EMPTY_AGENT_FEATURES,
  type AgentFeatures,
  type SessionMode,
  type ThinkingEffort,
} from '@agentctl/shared';
import type { SessionRuntimeRegistry } from './runtime/session-runtime-registry.js';
import type { McpGateway } from '../mcp/mcp-gateway.js';
import { DEFAULT_AGENT_MODEL } from '../config/runtime-defaults.js';
import type { SessionLauncher, CreateSessionParams } from './services/session-launcher.js';
import type { SessionLifecycleService } from './services/session-lifecycle-service.js';
import type { SessionHistoryService } from './services/session-history-service.js';
import { SessionOperationWorker } from './execution/session-operation-worker.js';
import type { SessionCommandHandler } from './commands/session-command-handler.js';

export type { IEventBus } from './contracts.js';

export { type CreateSessionParams };
export { resolveAgentSessionId } from './agent-session-id.js';

export class SessionManager {
  private readonly db: DbClient;
  private readonly providerRegistry: ProviderRegistry;
  private readonly logger: Logger;
  private readonly runtime: AgentDriver;

  private readonly operationWorker: SessionOperationWorker;
  private readonly eventRepository: SessionEventRepository;
  private readonly runtimeRegistry: SessionRuntimeRegistry;
  private readonly sessionWorkspace: SessionWorkspace;

  private readonly launcher: SessionLauncher;
  private readonly lifecycle: SessionLifecycleService;
  private readonly history: SessionHistoryService;
  private readonly commandHandler: SessionCommandHandler;

  constructor(
    db: DbClient,
    workspaceManager: WorkspaceManager,
    providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    logger: Logger = noopLogger,
    runtime?: AgentDriver,
    mcpGateway?: McpGateway,
    runtimeServices?: AgentRuntimeServices,
  ) {
    this.db = db;
    this.providerRegistry = providerRegistry;
    this.logger = logger;

    const resources = composeSessionResources(
      db,
      workspaceManager,
      providerRegistry,
      eventBus,
      logger,
      runtime,
      mcpGateway,
      runtimeServices,
    );
    this.runtime = resources.runtime;
    this.eventRepository = resources.eventRepository;
    this.runtimeRegistry = resources.runtimeRegistry;
    this.sessionWorkspace = resources.sessionWorkspace;

    const manager = () => this;
    const workflows = composeSessionWorkflows(
      {
        get db() {
          return manager().db;
        },
        get logger() {
          return manager().logger;
        },
        get runtime() {
          return manager().runtime;
        },
        get providerRegistry() {
          return manager().providerRegistry;
        },
        get eventRepository() {
          return manager().eventRepository;
        },
        get runtimeRegistry() {
          return manager().runtimeRegistry;
        },
        get sessionWorkspace() {
          return manager().sessionWorkspace;
        },
      },
      {
        startSession: (...args) => manager().startSession(...args),
        restartSession: (...args) => manager().restartSession(...args),
        getOrResuscitate: (...args) => manager().getOrResuscitate(...args),
        createForkSession: (...args) => manager().createForkSession(...args),
      },
    );
    this.launcher = workflows.launcher;
    this.lifecycle = workflows.lifecycle;
    this.history = workflows.history;
    this.commandHandler = workflows.commandHandler;
    this.operationWorker = new SessionOperationWorker(
      db,
      this.eventRepository,
      async (sessionId, message) => {
        await this.commandHandler.handleClientMessage(sessionId, 'session.input', {
          input: message.text,
          attachmentIds: message.attachmentIds,
          acceptedEventId: message.eventId,
          attemptId: message.attemptId,
        });
      },
      logger,
    );
  }

  private async executeMutation<T>(
    sessionId: string,
    kind: string,
    payload: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    let result!: T;
    await this.operationWorker.runCommand(sessionId, kind, payload, async () => {
      result = await execute();
    });
    return result;
  }

  // Public commands coordinate here; internal handlers call their dependencies directly.

  async ensureWorkspaceAvailable(sessionId: string): Promise<boolean> {
    return this.launcher.ensureWorkspaceAvailable(sessionId);
  }

  async syncOrphans(): Promise<void> {
    return this.lifecycle.syncOrphans();
  }

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    return this.commandHandler.writeTerminalInput(sessionId, terminalId, data);
  }

  async createSession(params: CreateSessionParams): Promise<{ sessionId: string }> {
    return this.launcher.createSession(params);
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
    return this.launcher.startSession(
      sessionId,
      worktreePath,
      command,
      args,
      env,
      selectedModel,
      selectedThinkingEffort,
      features,
      resolvedThinkingConfigId,
      intent,
      resolvedModelConfigId,
    );
  }

  async restartSession(
    sessionId: string,
    options: { resumeExisting?: boolean; nativeImport?: boolean } = {},
  ): Promise<SessionRuntime> {
    return this.launcher.restartSession(sessionId, options);
  }

  /** User-requested reconnect; runtime helpers use restartSession inside their existing command. */
  reconnectSession(sessionId: string): Promise<SessionRuntime> {
    return this.executeMutation(sessionId, 'session.reconnect', {}, () =>
      this.restartSession(sessionId),
    );
  }

  runWorkspaceCommand<T>(
    sessionId: string,
    payload: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    return this.executeMutation(sessionId, 'session.workspace', payload, execute);
  }

  async getOrResuscitate(
    sessionId: string,
    options?: { allowArchived?: boolean },
  ): Promise<SessionRuntime | null> {
    return this.launcher.getOrResuscitate(sessionId, options);
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<SessionRuntime | null> {
    return this.executeMutation(sessionId, 'session.mode', { newMode }, () =>
      this.lifecycle.switchMode(sessionId, newMode),
    );
  }

  getSession(sessionId: string): SessionRuntime | undefined {
    return this.runtimeRegistry.getSession(sessionId);
  }

  getSnapshotService() {
    return this.runtimeRegistry.getSnapshotService();
  }

  getRepositoryService() {
    return this.runtimeRegistry.getRepositoryService();
  }

  stopSessionAndWait(sessionId: string): Promise<void> {
    return this.runtimeRegistry.stopSessionAndWait(sessionId);
  }

  stopSession(sessionId: string): void {
    this.runtimeRegistry.stopSession(sessionId);
  }

  async stopAll(): Promise<void> {
    this.operationWorker.stop();
    try {
      await this.lifecycle.stopAll();
    } finally {
      await this.operationWorker.idleAll();
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.operationWorker.retireSession(
      sessionId,
      'session.delete',
      {},
      () => this.runtimeRegistry.stopSessionAndWait(sessionId),
      () => this.lifecycle.deleteSession(sessionId),
    );
  }

  async archiveSession(sessionId: string): Promise<void> {
    return this.operationWorker.retireSession(
      sessionId,
      'session.archive',
      {},
      () => this.runtimeRegistry.stopSessionAndWait(sessionId),
      () => this.lifecycle.archiveSession(sessionId),
    );
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
    targetBranch?: string,
  ): Promise<void> {
    return this.operationWorker.retireSession(
      sessionId,
      'session.finalize',
      { action, commitMessage, targetBranch },
      () => this.runtimeRegistry.stopSessionAndWait(sessionId),
      () => this.lifecycle.finalizeSession(sessionId, action, commitMessage, targetBranch),
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      with: { sessions: true },
    });
    if (!project) throw new Error(`Project not found: ${projectId}`);
    for (const session of project.sessions) await this.deleteSession(session.id);
    return this.lifecycle.deleteProject(projectId);
  }

  async updateSessionConfig(
    sessionId: string,
    params: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort?: ThinkingEffort;
    },
    options: { forceNewAgentSession?: boolean } = {},
  ): Promise<SessionRuntime | null> {
    return this.executeMutation(sessionId, 'session.configuration', { params, options }, () =>
      this.commandHandler.updateSessionConfig(sessionId, params, options),
    );
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    return this.executeMutation(
      sessionId,
      'session.configuration_option',
      { configId, value },
      () => this.commandHandler.setConfigOption(sessionId, configId, value),
    );
  }

  async setAgentPersona(sessionId: string, persona: string): Promise<void> {
    return this.executeMutation(sessionId, 'session.persona', { persona }, () =>
      this.commandHandler.setAgentPersona(sessionId, persona),
    );
  }

  async updateApprovalMode(sessionId: string, approvalMode: string): Promise<void> {
    return this.executeMutation(sessionId, 'session.approval_policy', { approvalMode }, () =>
      this.commandHandler.updateApprovalMode(sessionId, approvalMode),
    );
  }

  async handleClientMessage(
    sessionId: string,
    action:
      | 'approve'
      | 'deny'
      | 'cancel'
      | 'set_mode'
      | 'set_persona'
      | 'session.input'
      | 'set_config_option'
      | 'session.rewind',
    payload: {
      eventId?: string | number;
      optionId?: string;
      input?: string;
      attachmentIds?: string[];
      mode?: string;
      persona?: string;
      configId?: string;
      value?: string;
      onAccepted?: (eventId: number) => void;
      clientMessageId?: string;
      acceptedEventId?: number;
      attemptId?: string;
    },
  ): Promise<void> {
    if (action === 'cancel') {
      await Promise.all([
        this.commandHandler.handleClientMessage(sessionId, action, payload),
        this.operationWorker.cancelPending(sessionId),
      ]);
      return;
    }
    if (action === 'session.input') {
      const eventId = await this.startInput(
        sessionId,
        payload.input ?? '',
        payload.attachmentIds,
        payload.clientMessageId,
      );
      payload.onAccepted?.(eventId);
      return;
    }
    if (action === 'approve' || action === 'deny')
      return this.commandHandler.handleClientMessage(sessionId, action, payload);
    return this.operationWorker.runCommand(sessionId, action, payload, () =>
      this.commandHandler.handleClientMessage(sessionId, action, payload),
    );
  }

  /** Resolve after the user message is persisted, while the provider turn continues. */
  startInput(
    sessionId: string,
    input: string,
    attachmentIds?: string[],
    clientMessageId?: string,
  ): Promise<number> {
    return this.operationWorker.acceptMessage(sessionId, input, attachmentIds, clientMessageId);
  }

  resumeSessionQueue(sessionId: string): Promise<void> {
    return this.operationWorker.resumeQueue(sessionId);
  }

  changeQueuedMessage(
    sessionId: string,
    commandId: string,
    action: 'cancel' | 'up' | 'down' | 'edit',
    input?: string,
  ): Promise<void> {
    return this.operationWorker.changeQueuedMessage(sessionId, commandId, action, input);
  }

  async recoverInterruptedOperations(): Promise<void> {
    await this.operationWorker.recover();
  }

  async cancelQueuedMessages(sessionId: string): Promise<void> {
    await this.operationWorker.cancelPending(sessionId);
  }

  async waitForSessionOperations(sessionId: string): Promise<void> {
    await this.operationWorker.idle(sessionId);
  }

  async rewindSession(sessionId: string, eventId: number, mode: 'conversation' | 'files' | 'fork') {
    return this.executeMutation(sessionId, 'session.rewind', { eventId, mode }, () =>
      this.history.rewindSession(sessionId, eventId, mode),
    );
  }

  createForkSession(
    ...args: Parameters<SessionHistoryService['createForkSession']>
  ): ReturnType<SessionHistoryService['createForkSession']> {
    return this.history.createForkSession(...args);
  }

  async undoRewind(sessionId: string): Promise<void> {
    return this.executeMutation(sessionId, 'session.undo_rewind', {}, () =>
      this.history.undoRewind(sessionId),
    );
  }

  async previewSnapshotDiff(sessionId: string, eventId: number) {
    return this.history.previewSnapshotDiff(sessionId, eventId);
  }

  async undoDiscard(sessionId: string): Promise<void> {
    await this.sessionWorkspace.undoDiscard(sessionId);
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string): Promise<{ backupHash: string }> {
    return this.executeMutation(sessionId, 'session.restore_snapshot', { snapshotHash }, () =>
      this.history.restoreSnapshot(sessionId, snapshotHash),
    );
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ) {
    return this.executeMutation(
      sessionId,
      'session.handoff',
      { targetProvider, targetModel, nextSessionFocus },
      () => this.history.handoffSession(sessionId, targetProvider, targetModel, nextSessionFocus),
    );
  }

  getEventRepository(): SessionEventRepository {
    return this.eventRepository;
  }
}
