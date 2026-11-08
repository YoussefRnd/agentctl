import { eq, desc, and } from 'drizzle-orm';
import type { SessionRuntime } from '../runtime/session-runtime.js';
import { sessions, sessionEvents, nativeSessionImports } from '../../db/schema.js';
import {
  findAgentConfigOption,
  EMPTY_AGENT_FEATURES,
  createTaskSlug,
  type AgentConfigOption,
  type AgentFeatures,
  type SessionMode,
  type ThinkingEffort,
} from '@agentctl/shared';
import { negotiateCapabilities } from '../../providers/capabilities-negotiator.js';
import type { AgentSessionIntent } from '../../agent/types.js';
import { ProviderContextDelivery } from '../execution/provider-context-delivery.js';
import { resolveAgentSessionId } from '../agent-session-id.js';
import type { SessionEventRepository } from '../persistence/session-event-repository.js';
import type { DbClient } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import type { SessionRuntimeRegistry } from '../runtime/session-runtime-registry.js';
import type { SessionWorkspace } from '../../workspace/session-workspace.js';

const DEFAULT_AGENT_MODEL = '';

export interface CreateSessionParams {
  projectId: string;
  providerId?: string;
  taskSlug?: string;
  mode?: SessionMode;
  selectedModel?: string;
  selectedThinkingEffort?: ThinkingEffort;
  approvalMode?: 'review' | 'auto_approve' | 'yolo';
  agentPersona?: string;
}

export interface SessionLauncherDependencies {
  db: DbClient;
  eventRepository: Pick<SessionEventRepository, 'append'>;
  logger: Logger;
  providerRegistry: Pick<ProviderRegistry, 'discover' | 'ensureProviderReady' | 'getSettings'>;
  runtimeRegistry: Pick<SessionRuntimeRegistry, 'getSession' | 'startSession' | 'stopSession'>;
  sessionWorkspace: Pick<SessionWorkspace, 'activate' | 'ensureAvailable' | 'establish'>;
  startSession: SessionLauncher['startSession'];
  restartSession: SessionLauncher['restartSession'];
}

export class SessionLauncher {
  private readonly pendingResuscitations = new Map<string, Promise<SessionRuntime>>();
  constructor(private readonly deps: SessionLauncherDependencies) {}

  async reportModelFallback(
    sessionId: string,
    selection: ReturnType<typeof negotiateCapabilities>,
  ) {
    if (!selection.modelFallback) return;
    const { requested, selected } = selection.modelFallback;
    await this.deps.eventRepository.append(sessionId, 'status', {
      status: 'model_fallback',
      title: `Model “${requested}” is unavailable. Using “${selected}”.`,
    });
  }

  buildInitialConfigOptions(
    providerConfigOptions: AgentConfigOption[],
    selectedModel: string,
    selectedThinkingEffort: ThinkingEffort,
  ): AgentConfigOption[] {
    const modelOption = findAgentConfigOption(providerConfigOptions, 'model');
    const thinkingOption = findAgentConfigOption(providerConfigOptions, 'thought_level');
    return providerConfigOptions.map((opt) => {
      if (opt === modelOption) {
        return { ...opt, currentValue: selectedModel };
      }
      if (opt === thinkingOption && selectedThinkingEffort !== null) {
        return { ...opt, currentValue: selectedThinkingEffort };
      }
      return opt;
    });
  }

  async resolveLaunchParameters(
    providerId: string,
    requestedModel?: string,
    requestedThinkingEffort?: ThinkingEffort,
  ) {
    const provider = await this.deps.providerRegistry.ensureProviderReady(providerId, {
      force: false,
    });
    if (!provider.isReady && !provider.needsAuth) {
      throw new Error(`Selected agent is not ready: ${providerId}`);
    }

    const selection = negotiateCapabilities(provider, requestedModel, requestedThinkingEffort);

    const launch = provider.getLaunchConfig(
      selection.selectedModel,
      selection.selectedThinkingEffort,
    );

    return {
      launch,
      selection,
      configOptions: this.buildInitialConfigOptions(
        provider.toDiscovery().configOptions ?? [],
        selection.selectedModel,
        selection.selectedThinkingEffort,
      ),
    };
  }

  async resolveSessionProviderAndParameters(
    projectId: string,
    requestedProviderId?: string,
    requestedModel?: string,
    requestedThinkingEffort?: ThinkingEffort,
  ): Promise<{
    providerId: string;
    selection: ReturnType<typeof negotiateCapabilities>;
    configOptions: AgentConfigOption[];
  }> {
    if (requestedProviderId) {
      const { selection, configOptions } = await this.resolveLaunchParameters(
        requestedProviderId,
        requestedModel,
        requestedThinkingEffort,
      );
      return {
        providerId: requestedProviderId,
        selection,
        configOptions,
      };
    }

    try {
      const lastSession = await this.deps.db.query.sessions.findFirst({
        where: eq(sessions.projectId, projectId),
        orderBy: [desc(sessions.createdAt)],
      });

      if (lastSession?.selectedProvider) {
        try {
          const inheritedModel = requestedModel ?? lastSession.selectedModel ?? undefined;
          const inheritedEffort =
            requestedThinkingEffort ??
            (lastSession.selectedThinkingEffort as ThinkingEffort | undefined);

          const { selection, configOptions } = await this.resolveLaunchParameters(
            lastSession.selectedProvider,
            inheritedModel,
            inheritedEffort,
          );
          return {
            providerId: lastSession.selectedProvider,
            selection,
            configOptions,
          };
        } catch (err) {
          this.deps.logger.warn(
            { err, providerId: lastSession.selectedProvider, projectId },
            'Failed to inherit last-used provider from project; falling back',
          );
        }
      }
    } catch (err) {
      this.deps.logger.warn({ err, projectId }, 'Failed to query project sessions for inheritance');
    }

    const settings = await this.deps.providerRegistry.getSettings();
    const defaultProviderId = settings.defaultProviderId;
    if (defaultProviderId) {
      try {
        const { selection, configOptions } = await this.resolveLaunchParameters(
          defaultProviderId,
          requestedModel,
          requestedThinkingEffort,
        );
        return {
          providerId: defaultProviderId,
          selection,
          configOptions,
        };
      } catch (err) {
        this.deps.logger.warn(
          { err, providerId: defaultProviderId },
          'Configured default provider is not ready; falling back to discoverable providers',
        );
      }
    }

    try {
      if (typeof this.deps.providerRegistry.discover === 'function') {
        const discoverable = await this.deps.providerRegistry.discover();
        for (const candidate of discoverable) {
          if (candidate.id === defaultProviderId) continue;
          try {
            const { selection, configOptions } = await this.resolveLaunchParameters(
              candidate.id,
              requestedModel,
              requestedThinkingEffort,
            );
            return {
              providerId: candidate.id,
              selection,
              configOptions,
            };
          } catch {
            continue;
          }
        }
      }
    } catch (err) {
      this.deps.logger.warn({ err }, 'Failed to discover fallback providers');
    }

    throw new Error(
      'No agent provider is available or ready. Please configure or install an agent provider in settings.',
    );
  }

  async createSession(params: CreateSessionParams): Promise<{ sessionId: string }> {
    const { projectId, providerId, taskSlug, mode, selectedModel, selectedThinkingEffort } = params;

    const {
      providerId: resolvedProviderId,
      selection,
      configOptions,
    } = await this.resolveSessionProviderAndParameters(
      projectId,
      providerId,
      selectedModel,
      selectedThinkingEffort,
    );

    const settings = await this.deps.providerRegistry.getSettings();
    const defaultToWorktree =
      settings.defaultToWorktree !== undefined ? settings.defaultToWorktree === 'true' : true;
    const effectiveMode: SessionMode | undefined =
      mode ?? (defaultToWorktree ? undefined : 'local');
    const effectiveSlug = createTaskSlug(taskSlug);

    const provider = await this.deps.providerRegistry.ensureProviderReady(resolvedProviderId, {
      force: false,
    });
    const discovery = provider.toDiscovery();
    const modeOption = discovery.configOptions?.find((option) => option.category === 'mode');
    const availableAgentPersonas = [
      ...new Set([
        ...(discovery.modes ?? []),
        ...(modeOption?.options?.map((option) => option.value) ?? []),
      ]),
    ];
    if (params.agentPersona && !availableAgentPersonas.includes(params.agentPersona)) {
      throw new Error(`Agent persona is not available: ${params.agentPersona}`);
    }

    const context = await this.deps.sessionWorkspace.establish(projectId, effectiveSlug, {
      mode: effectiveMode,
      agent: resolvedProviderId,
      selectedProvider: resolvedProviderId,
      selectedModel: selection.selectedModel,
      selectedThinkingEffort: selection.selectedThinkingEffort,
      contextLimit: 0,
      sessionConfigOptions: JSON.stringify(configOptions),
      approvalMode: params.approvalMode,
      agentPersona: params.agentPersona,
      availableAgentPersonas,
    });

    await this.reportModelFallback(context.sessionId, selection);
    return { sessionId: context.sessionId };
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
    await this.ensureWorkspaceAvailable(sessionId);
    return this.deps.runtimeRegistry.startSession(
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

  async ensureWorkspaceAvailable(sessionId: string): Promise<boolean> {
    return this.deps.sessionWorkspace.ensureAvailable(sessionId);
  }

  async restartSession(
    sessionId: string,
    options: { resumeExisting?: boolean; nativeImport?: boolean } = {},
  ): Promise<SessionRuntime> {
    const pendingImport = await this.deps.db.query.nativeSessionImports?.findFirst({
      where: and(
        eq(nativeSessionImports.sessionId, sessionId),
        eq(nativeSessionImports.completed, false),
      ),
    });
    if (pendingImport && !options.nativeImport)
      throw new Error('Finish importing this native session before starting it');
    this.deps.logger.info({ sessionId }, 'Restarting session');
    this.deps.runtimeRegistry.stopSession(sessionId);

    await this.deps.db
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      with: { project: true },
    });

    if (!sessionRecord) {
      throw new Error(`Session or associated project not found: ${sessionId}`);
    }

    const { launch, selection, configOptions } = await this.resolveLaunchParameters(
      sessionRecord.selectedProvider,
      sessionRecord.selectedModel,
      sessionRecord.selectedThinkingEffort as ThinkingEffort,
    );

    await this.deps.db
      .update(sessions)
      .set({
        sessionConfigOptions: JSON.stringify(configOptions),
        selectedModel: selection.selectedModel,
        selectedThinkingEffort: selection.selectedThinkingEffort,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    await this.reportModelFallback(sessionId, selection);

    let workspacePath =
      sessionRecord.mode === 'worktree' ? sessionRecord.worktreePath : sessionRecord.project.path;

    if (sessionRecord.status === 'archived') {
      const context = await this.deps.sessionWorkspace.activate(sessionId, {
        baseBranch: sessionRecord.baseBranch ?? 'main',
      });
      workspacePath = context.worktreePath;
    } else {
      await this.ensureWorkspaceAvailable(sessionId);
    }

    let hasUserMessages = false;
    if (options.resumeExisting !== false && typeof this.deps.db.select === 'function') {
      const messages = await this.deps.db
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.type, 'text')));
      hasUserMessages = messages.length > 0;
    }

    let resolvedAgentSessionId =
      (hasUserMessages || options.nativeImport) && options.resumeExisting !== false
        ? resolveAgentSessionId(
            sessionRecord.agentSessionId,
            sessionRecord.selectedProvider,
            sessionRecord.agent,
          )
        : null;

    if (
      resolvedAgentSessionId &&
      !ProviderContextDelivery.canResume(this.deps.db, {
        sessionId,
        providerId: sessionRecord.selectedProvider,
        nativeSessionId: resolvedAgentSessionId,
      })
    ) {
      resolvedAgentSessionId = null;
    }

    return this.deps.startSession(
      sessionId,
      workspacePath,
      launch.command,
      launch.args,
      launch.env,
      selection.selectedModel,
      selection.selectedThinkingEffort,
      selection.features,
      selection.resolvedThinkingConfigId,
      resolvedAgentSessionId
        ? {
            kind: 'resume',
            sessionId: resolvedAgentSessionId,
            ...(options.nativeImport ? { requireExisting: true } : {}),
          }
        : { kind: 'new' },
      selection.resolvedModelConfigId,
    );
  }

  async getOrResuscitate(
    sessionId: string,
    options?: { allowArchived?: boolean },
  ): Promise<SessionRuntime | null> {
    const pendingImport = await this.deps.db.query.nativeSessionImports?.findFirst({
      where: and(
        eq(nativeSessionImports.sessionId, sessionId),
        eq(nativeSessionImports.completed, false),
      ),
    });
    if (pendingImport) return null;
    await this.ensureWorkspaceAvailable(sessionId);
    const session = this.deps.runtimeRegistry.getSession(sessionId);
    if (session && !session.isDead) {
      return session;
    }

    const sessionRecord = await this.deps.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!sessionRecord) {
      return null;
    }

    if (sessionRecord.status === 'merged' || sessionRecord.status === 'discarded') {
      this.deps.logger.warn(
        { sessionId, status: sessionRecord.status },
        'Cannot resuscitate a merged or discarded session',
      );
      return null;
    }

    if (sessionRecord.status === 'archived' && !options?.allowArchived) {
      return null;
    }

    this.deps.logger.info({ sessionId }, 'Resuscitating session runtime');
    const pending = this.pendingResuscitations.get(sessionId);
    if (pending) return pending;
    const current = this.deps.runtimeRegistry.getSession(sessionId);
    if (current && !current.isDead) return current;
    const restart = this.deps.restartSession(sessionId);
    this.pendingResuscitations.set(sessionId, restart);
    try {
      return await restart;
    } finally {
      if (this.pendingResuscitations.get(sessionId) === restart)
        this.pendingResuscitations.delete(sessionId);
    }
  }
}
