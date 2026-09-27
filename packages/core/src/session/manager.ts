import type { ManagedSession } from './managed-session.js';
import type { DbClient } from '../db/index.js';
import type { AgentDriver, AgentSessionIntent } from '../agent/types.js';
import type { AgentRuntimeServices } from '../agent/runtime-services.js';
import { createDefaultAgentDriver } from '../default-agent-driver.js';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import { SessionEventStore } from './event-store.js';
import type { WorkspaceManager } from '../git/worktree-manager.js';
import { SessionWorkspace } from '../git/session-workspace.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import {
  EMPTY_AGENT_FEATURES,
  type AgentFeatures,
  type SessionMode,
  type ThinkingEffort,
} from '@agentctl/shared';
import { SessionStateMachine } from './state-machine.js';
import type { McpGateway } from '../mcp/mcp-gateway.js';
import { DEFAULT_AGENT_MODEL, DEFAULT_THINKING_EFFORT } from '../config/runtime-defaults.js';
import { SessionLauncher, type CreateSessionParams } from './services/session-launcher.js';
import { SessionLifecycleService } from './services/session-lifecycle-service.js';
import { SessionHistoryService } from './services/session-history-service.js';
import { SessionCommandRouter } from './services/session-command-router.js';

export interface IEventBus {
  publish(event: unknown): void;
}

export { type CreateSessionParams };
export { resolveAgentSessionId } from './agent-session-id.js';

export class SessionManager {
  private readonly db: DbClient;
  private readonly providerRegistry: ProviderRegistry;
  private readonly logger: Logger;
  private readonly runtime: AgentDriver;

  private readonly eventStore: SessionEventStore;
  private readonly stateMachine: SessionStateMachine;
  private readonly sessionWorkspace: SessionWorkspace;

  private readonly launcher: SessionLauncher;
  private readonly lifecycle: SessionLifecycleService;
  private readonly history: SessionHistoryService;
  private readonly commandRouter: SessionCommandRouter;

  constructor(
    db: DbClient,
    workspaceManager: WorkspaceManager,
    providerRegistry: ProviderRegistry,
    eventBus: IEventBus,
    logger: Logger = noopLogger,
    runtime: AgentDriver = createDefaultAgentDriver(logger),
    mcpGateway?: McpGateway,
    runtimeServices?: AgentRuntimeServices,
  ) {
    this.db = db;
    this.providerRegistry = providerRegistry;
    this.logger = logger;

    if (runtimeServices) {
      this.runtime = runtimeServices.driver;
    } else {
      this.runtime = runtime;
      const connectionAwareRuntime = this.runtime as AgentDriver & {
        setConnectionManager?: (manager: unknown) => void;
      };
      if (connectionAwareRuntime.setConnectionManager) {
        connectionAwareRuntime.setConnectionManager(this.providerRegistry.getConnectionManager());
      }
    }

    this.eventStore = new SessionEventStore(db, eventBus);
    this.stateMachine = new SessionStateMachine(
      db,
      workspaceManager,
      providerRegistry,
      this.eventStore,
      logger,
      this.runtime,
      mcpGateway,
    );
    this.sessionWorkspace = new SessionWorkspace(
      db,
      workspaceManager,
      (sessionId) => {
        this.stateMachine.stopSession(sessionId);
      },
      () => this.stateMachine.getSnapshotService(),
    );

    const manager = () => this;
    this.launcher = new SessionLauncher({
      get db() {
        return manager().db;
      },
      get logger() {
        return manager().logger;
      },
      get stateMachine() {
        return manager().stateMachine;
      },
      get sessionWorkspace() {
        return manager().sessionWorkspace;
      },
      get providerRegistry() {
        return manager().providerRegistry;
      },
      startSession: (...args) => manager().startSession(...args),
      restartSession: (...args) => manager().restartSession(...args),
    });
    this.lifecycle = new SessionLifecycleService({
      get db() {
        return manager().db;
      },
      get logger() {
        return manager().logger;
      },
      get stateMachine() {
        return manager().stateMachine;
      },
      get sessionWorkspace() {
        return manager().sessionWorkspace;
      },
      get runtime() {
        return manager().runtime;
      },
      launcher: this.launcher,
      restartSession: (...args) => manager().restartSession(...args),
    });
    this.history = new SessionHistoryService({
      get db() {
        return manager().db;
      },
      get logger() {
        return manager().logger;
      },
      get stateMachine() {
        return manager().stateMachine;
      },
      get sessionWorkspace() {
        return manager().sessionWorkspace;
      },
      get eventStore() {
        return manager().eventStore;
      },
      launcher: this.launcher,
      startSession: (...args) => manager().startSession(...args),
      restartSession: (...args) => manager().restartSession(...args),
      createForkSession: (...args) => manager().createForkSession(...args),
      updateSessionConfig: (sessionId, params, options) =>
        manager().updateSessionConfig(sessionId, params, options),
    });
    this.commandRouter = new SessionCommandRouter({
      get db() {
        return manager().db;
      },
      get logger() {
        return manager().logger;
      },
      get stateMachine() {
        return manager().stateMachine;
      },
      get providerRegistry() {
        return manager().providerRegistry;
      },
      get eventStore() {
        return manager().eventStore;
      },
      launcher: this.launcher,
      restartSession: (...args) => manager().restartSession(...args),
      getOrResuscitate: (...args) => manager().getOrResuscitate(...args),
      switchMode: (...args) => manager().switchMode(...args),
      rewindSession: (...args) => manager().rewindSession(...args),
      clearRewindBackup: (...args) => manager().history.clearRewindBackup(...args),
    });
  }

  // --- Delegated Facade Methods ---

  async syncOrphans(): Promise<void> {
    return this.lifecycle.syncOrphans();
  }

  writeTerminalInput(sessionId: string, terminalId: string, data: string): boolean {
    return this.commandRouter.writeTerminalInput(sessionId, terminalId, data);
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
    selectedThinkingEffort: ThinkingEffort = DEFAULT_THINKING_EFFORT,
    features: AgentFeatures = EMPTY_AGENT_FEATURES,
    resolvedThinkingConfigId?: string,
    intent: AgentSessionIntent = { kind: 'new' },
    resolvedModelConfigId?: string,
  ): Promise<ManagedSession> {
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
    options: { resumeExisting?: boolean } = {},
  ): Promise<ManagedSession> {
    return this.launcher.restartSession(sessionId, options);
  }

  async getOrResuscitate(
    sessionId: string,
    options?: { allowArchived?: boolean },
  ): Promise<ManagedSession | null> {
    return this.launcher.getOrResuscitate(sessionId, options);
  }

  async switchMode(sessionId: string, newMode: SessionMode): Promise<ManagedSession | null> {
    return this.lifecycle.switchMode(sessionId, newMode);
  }

  getSession(sessionId: string): ManagedSession | undefined {
    return this.stateMachine.getSession(sessionId);
  }

  getSnapshotService() {
    return this.stateMachine.getSnapshotService();
  }

  stopSession(sessionId: string): void {
    this.stateMachine.stopSession(sessionId);
  }

  async stopAll(): Promise<void> {
    return this.lifecycle.stopAll();
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.lifecycle.deleteSession(sessionId);
  }

  async archiveSession(sessionId: string): Promise<void> {
    return this.lifecycle.archiveSession(sessionId);
  }

  async finalizeSession(
    sessionId: string,
    action: 'merge' | 'discard',
    commitMessage?: string,
  ): Promise<void> {
    return this.lifecycle.finalizeSession(sessionId, action, commitMessage);
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.lifecycle.deleteProject(projectId);
  }

  async updateSessionConfig(
    sessionId: string,
    params: {
      selectedProvider: string;
      selectedModel: string;
      selectedThinkingEffort: ThinkingEffort;
    },
    options: { forceNewAgentSession?: boolean } = {},
  ): Promise<ManagedSession | null> {
    return this.commandRouter.updateSessionConfig(sessionId, params, options);
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    return this.commandRouter.setConfigOption(sessionId, configId, value);
  }

  async setAgentPersona(sessionId: string, persona: string): Promise<void> {
    return this.commandRouter.setAgentPersona(sessionId, persona);
  }

  async updateApprovalMode(sessionId: string, approvalMode: string): Promise<void> {
    return this.commandRouter.updateApprovalMode(sessionId, approvalMode);
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
    },
  ): Promise<void> {
    return this.commandRouter.handleClientMessage(sessionId, action, payload);
  }

  /** Resolve after the user message is persisted, while the provider turn continues. */
  startInput(sessionId: string, input: string, attachmentIds?: string[]): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let accepted = false;
      void this.handleClientMessage(sessionId, 'session.input', {
        input,
        attachmentIds,
        onAccepted: (eventId) => {
          accepted = true;
          resolve(eventId);
        },
      }).then(
        () => {
          if (!accepted) reject(new Error('Session did not accept the message'));
        },
        (error: unknown) => {
          if (accepted) {
            this.logger.error(error, `Prompt failed after acceptance for session ${sessionId}`);
          } else {
            reject(error);
          }
        },
      );
    });
  }

  async rewindSession(sessionId: string, eventId: number, mode: 'conversation' | 'files' | 'fork') {
    return this.history.rewindSession(sessionId, eventId, mode);
  }

  createForkSession(
    ...args: Parameters<SessionHistoryService['createForkSession']>
  ): ReturnType<SessionHistoryService['createForkSession']> {
    return this.history.createForkSession(...args);
  }

  async undoRewind(sessionId: string): Promise<void> {
    return this.history.undoRewind(sessionId);
  }

  async previewSnapshotDiff(sessionId: string, eventId: number) {
    return this.history.previewSnapshotDiff(sessionId, eventId);
  }

  async restoreSnapshot(sessionId: string, snapshotHash: string): Promise<{ backupHash: string }> {
    return this.history.restoreSnapshot(sessionId, snapshotHash);
  }

  async handoffSession(
    sessionId: string,
    targetProvider: string,
    targetModel?: string,
    nextSessionFocus?: string,
  ) {
    return this.history.handoffSession(sessionId, targetProvider, targetModel, nextSessionFocus);
  }

  getEventStore(): SessionEventStore {
    return this.eventStore;
  }
}
