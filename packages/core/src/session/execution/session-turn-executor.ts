import { and, eq } from 'drizzle-orm';
import { sessions, sessionTurnAttempts, sessionOperations } from '../../db/schema.js';
import { randomUUID } from 'node:crypto';
import { TurnDiagnostics } from './turn-diagnostics.js';
import { TurnObservation, type TurnOutcome } from '../../observability/index.js';
import type { DbClient } from '../../db/index.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import type { Logger } from '../../logger.js';
import type { AgentMcpGateway, AgentSession, AgentUsage, AgentUpdate } from '../../agent/types.js';
import {
  undispatchedCancellation,
  type SessionEventRepositoryLike,
  type SessionStatusTransitioner,
} from '../contracts.js';
import type { SessionStateProjector } from '../projection/session-state-projector.js';
import type { PermissionEngine } from '../../security/permission-engine.js';
import { SkillRegistry, type SkillActivation } from '../../skills/registry.js';
import {
  isDefaultSessionTitle,
  normalizeReportedCost,
  findAgentConfigOption,
  type TurnTimings,
  type ChatError,
} from '@agentctl/shared';
import { resolveMessageAttachments } from '../commands/message-attachments.js';
import { normalizeChatError } from '../../agent/chat-error.js';
import { AgentError } from '../../agent/errors.js';
import type { SessionTurnStore } from '../persistence/session-turn-store.js';
import { SkillCatalogDelivery } from './skill-catalog-delivery.js';
import {
  ProviderContextRecoveryError,
  ProviderContextDelivery,
} from './provider-context-delivery.js';
import { providerContextByteBudget, attachmentContextAllowance } from '../context-budget.js';
import { HistoryTranscriptBudgetError } from '../history-transcript.js';

interface TurnRuntimeState {
  runtimeId: string;
  isStopped(): boolean;
  beginAttempt(attemptId?: string): void;
  endAttempt(): void;
  markDispatched(attemptId?: string): boolean;
  onError(error: unknown): Promise<void>;
}

class TurnCancelledBeforeDispatch extends Error {}

/** Owns one prompt turn: context preparation, dispatch, output and usage finalization. */
export class SessionTurnExecutor {
  private activeTurn?: { cancelled: boolean };
  private skillCatalog: SkillCatalogDelivery;
  private contextDelivery?: ProviderContextDelivery;
  private diagnosticTurn?: {
    attemptId: string;
    eventId?: number;
    diagnostics: TurnDiagnostics;
    observation: TurnObservation;
  };
  constructor(
    private sessionId: string,
    private runtimeHandle: AgentSession,
    private db: DbClient,
    private store: SessionTurnStore,
    private eventRepository: SessionEventRepositoryLike,
    private cwd: string,
    private projector: SessionStateProjector,
    private permissionEngine: PermissionEngine,
    private logger: Logger,
    private deps: TurnRuntimeState,
    private runtimeRegistry?: SessionStatusTransitioner,
    private mcpGateway?: AgentMcpGateway,
  ) {
    this.skillCatalog = new SkillCatalogDelivery(store, sessionId, runtimeHandle);
  }

  async observeUpdate(event: AgentUpdate): Promise<void> {
    if (event.type === 'context_compacted') this.skillCatalog.compacted(event.compactionId);
    const turn = this.diagnosticTurn;
    const phase = turn?.diagnostics.observe(event);
    if (!phase || !turn) return;
    turn.observation.phase(phase);
    await this.eventRepository.append(
      this.sessionId,
      'status',
      {
        status: phase,
        timings: turn.diagnostics.snapshot(),
      },
      turn.eventId,
      { attemptId: turn.attemptId },
    );
  }

  requestCancellation(): void {
    if (this.activeTurn) this.activeTurn.cancelled = true;
  }

  private claimDispatch(attemptId?: string): void {
    if (this.activeTurn?.cancelled || !this.deps.markDispatched(attemptId))
      throw new TurnCancelledBeforeDispatch();
  }

  private async returnToIdle(): Promise<void> {
    if (this.runtimeRegistry) {
      await this.runtimeRegistry.transitionTo(this.sessionId, 'idle', {
        runtimeId: this.deps.runtimeId,
      });
    } else {
      this.store.setSessionStatus(this.sessionId, 'idle');
    }
  }

  private async recordFailure(
    attemptId: string,
    eventId: number | undefined,
    error: ChatError,
    timings: TurnTimings,
  ): Promise<void> {
    const attempt = await this.db
      .select({ operationId: sessionTurnAttempts.operationId })
      .from(sessionTurnAttempts)
      .where(eq(sessionTurnAttempts.id, attemptId))
      .get();
    if (attempt)
      await this.db
        .update(sessionOperations)
        .set({ error: error.message, updatedAt: new Date() })
        .where(eq(sessionOperations.id, attempt.operationId));
    await this.eventRepository.append(
      this.sessionId,
      'status',
      {
        status: 'prompt_failed',
        message: error.message,
        error,
        timings,
      },
      eventId,
      { attemptId },
    );
  }

  private async parseAndExecuteMcpCommand(
    text: string,
    attemptId?: string,
  ): Promise<{ result: string; toolName: string; args: string } | null> {
    const match = /^\/([a-zA-Z0-9_-]+):([a-zA-Z0-9_:-]+)(.*)$/.exec(text);
    if (!match) return null;

    const [, serverId, shortToolName, rawArgs] = match;
    const toolName = `${serverId}__${shortToolName}`;
    const argsText = rawArgs.trim();

    this.logger.info({ serverId, toolName, argsText }, 'Intercepted manual MCP tool call command');

    if (!this.mcpGateway) {
      throw new Error('MCP gateway not available');
    }

    const tools = await this.mcpGateway.getTools();
    const toolDef = tools.find((t) => t.name === toolName || t.name === shortToolName);

    let parsedArgs: Record<string, unknown> = {};
    if (argsText) {
      try {
        if (argsText.startsWith('{')) {
          parsedArgs = JSON.parse(argsText) as Record<string, unknown>;
        } else {
          const schema = toolDef?.inputSchema;
          const properties = schema?.properties as Record<string, { type?: string }> | undefined;
          const required = schema?.required as string[] | undefined;
          const stringParam = Object.entries(properties ?? {}).find(
            ([name, prop]) => prop.type === 'string' && (required ? required.includes(name) : true),
          )?.[0];

          if (stringParam) {
            parsedArgs[stringParam] = argsText;
          } else {
            parsedArgs.query = argsText;
          }
        }
      } catch {
        parsedArgs = { query: argsText };
      }
    }

    this.claimDispatch(attemptId);
    try {
      const output = await this.mcpGateway.callTool(serverId, shortToolName, parsedArgs);
      return {
        result: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
        toolName,
        args: JSON.stringify(parsedArgs),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`MCP tool call failed: ${msg}`);
    }
  }

  async execute(
    text: string,
    attachmentIds?: string[],
    embeddedContext?: string,
    skillActivation?: SkillActivation,
    onAccepted?: (eventId: number) => void,
    clientMessageId?: string,
    accepted?: { eventId: number; attemptId: string },
  ): Promise<void> {
    if (this.deps.isStopped()) throw new Error('Session runtime is closed');
    if (this.activeTurn) throw new Error('prompt already in progress');
    const observation = new TurnObservation();
    return observation.run(async () => {
      try {
        await this.executeTurn(
          observation,
          text,
          attachmentIds,
          embeddedContext,
          skillActivation,
          onAccepted,
          clientMessageId,
          accepted,
        );
      } finally {
        observation.finish('error', {});
      }
    });
  }

  private async executeTurn(
    observation: TurnObservation,
    text: string,
    attachmentIds?: string[],
    embeddedContext?: string,
    skillActivation?: SkillActivation,
    onAccepted?: (eventId: number) => void,
    clientMessageId?: string,
    accepted?: { eventId: number; attemptId: string },
  ): Promise<void> {
    const activeTurn = { cancelled: false };
    this.activeTurn = activeTurn;
    const attemptId = accepted?.attemptId ?? randomUUID();
    const diagnostics = new TurnDiagnostics();
    this.diagnosticTurn = { attemptId, eventId: accepted?.eventId, diagnostics, observation };
    this.deps.beginAttempt(attemptId);
    this.permissionEngine.clearTurn();
    let outcome: TurnOutcome = 'error';
    let pendingHistory: Awaited<ReturnType<ProviderContextDelivery['prepare']>> | undefined;
    let executedMcpCommand = false;
    try {
      const sessionRecord = await this.store.session(this.sessionId);

      const { metadata: resolvedAttachmentsMeta, files: resolvedAttachmentFiles } =
        await resolveMessageAttachments(this.sessionId, attachmentIds);

      const nativelyLoadsSkills = sessionRecord?.selectedProvider
        ? await this.store.providerLoadsSkills(sessionRecord.selectedProvider)
        : false;

      const requestedSkill = /^\/([a-z0-9-]+)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
      const registry = await SkillRegistry.load({
        cwd: this.cwd,
        includeWorkspaceSkills: !nativelyLoadsSkills,
      });
      const activation = skillActivation ?? (requestedSkill ? { name: requestedSkill } : undefined);
      const missingSkill =
        skillActivation && !registry.activate(skillActivation)
          ? (skillActivation.name ?? `purpose "${skillActivation.purpose}"`)
          : undefined;
      const skills = this.skillCatalog.prepare(registry, activation);
      const instructions = [embeddedContext, skills.context].filter(Boolean).join('\n\n---\n\n');
      const contextDelivery = (this.contextDelivery ??= new ProviderContextDelivery(
        this.db,
        {
          sessionId: this.sessionId,
          providerId: sessionRecord?.selectedProvider ?? '',
          nativeSessionId: this.runtimeHandle.id ?? this.deps.runtimeId,
        },
        this.runtimeHandle.history === 'fresh',
      ));
      const modelWindow = findAgentConfigOption(
        jsonCodecs.agentConfigOptionsOrNull(sessionRecord?.sessionConfigOptions) ?? [],
        'model',
      )?.options?.find((option) => option.value === sessionRecord?.selectedModel)?.contextWindow;
      const window = Math.min(sessionRecord?.contextLimit || Infinity, modelWindow ?? Infinity);
      const attachmentMimeTypes = resolvedAttachmentFiles.map((file) => file.mimeType);
      const prepareHistory = (userText: string, eventId?: number) =>
        contextDelivery.prepare(
          eventId,
          providerContextByteBudget({
            contextWindow: Number.isFinite(window) ? window : undefined,
            usedTokens: sessionRecord?.contextUsedTokens ?? contextDelivery.usedTokens,
            userText,
            instructions,
            attachmentMimeTypes,
          }),
        );
      const prepared =
        missingSkill === undefined
          ? { history: await prepareHistory(text, accepted?.eventId) }
          : { error: new Error(`Agent skill not found: ${missingSkill}`) };
      if (activeTurn.cancelled) throw new TurnCancelledBeforeDispatch();

      if (sessionRecord && isDefaultSessionTitle(sessionRecord.title, sessionRecord.taskSlug)) {
        const summary = text.trim();
        const firstLine = summary.split('\n')[0] || '';
        const titleVal = firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
        await this.db
          .update(sessions)
          .set({ title: titleVal || sessionRecord.title })
          .where(eq(sessions.id, this.sessionId));
      }

      if (this.runtimeRegistry) {
        await this.runtimeRegistry.transitionTo(this.sessionId, 'running', {
          runtimeId: this.deps.runtimeId,
        });
      } else {
        await this.store.setSessionStatus(this.sessionId, 'running');
      }

      let promptText = text;
      const promptTokens = Math.ceil(text.length / 4);
      const turn = await this.projector.startTurn(
        text,
        resolvedAttachmentsMeta,
        promptTokens,
        clientMessageId,
        attachmentIds,
        accepted?.eventId,
        attemptId,
      );
      this.diagnosticTurn.eventId = turn.eventId;
      onAccepted?.(turn.eventId);
      await this.eventRepository.append(
        this.sessionId,
        'status',
        { status: 'turn_started' },
        turn.eventId,
        { attemptId },
      );
      // Acceptance need not wait for Git, but tools must see a completed baseline.
      const startSnapshotHash = await turn.snapshotPromise;

      if (text.startsWith('/')) {
        try {
          const executed = await this.parseAndExecuteMcpCommand(text, accepted?.attemptId);
          if (executed) {
            executedMcpCommand = true;
            promptText = `[System Notification: The user manually executed the tool "${executed.toolName}" with args: "${executed.args}". Result:\n---\n${executed.result}\n---\nAnalyze this output and answer the user's request.]`;

            await this.projector.appendText(
              `\n\n*Manual Tool Execution Result [${executed.toolName}]:*\n\`\`\`json\n${executed.result}\n\`\`\`\n`,
            );
            await this.projector.flushAll();
          }
        } catch (err: unknown) {
          if (err instanceof TurnCancelledBeforeDispatch) throw err;
          this.logger.error(err, 'Manual MCP tool execution failed');
          const failure = normalizeChatError(err, {
            stage: 'stream',
            attemptId,
            eventId: turn.eventId,
            providerId: sessionRecord?.selectedProvider,
          });
          const timings = diagnostics.finish();
          await this.store.finishAttempt(attemptId, 'failed');
          await this.eventRepository.append(
            this.sessionId,
            'status',
            { status: 'turn_end', stopReason: 'error', timings, error: failure },
            turn.eventId,
            { attemptId },
          );
          await this.recordFailure(attemptId, turn.eventId, failure, timings);

          await this.returnToIdle();
          return; // Do not call the model if direct execution failed
        }
      }

      if (prepared.error) throw prepared.error;
      let { history } = prepared;
      if (executedMcpCommand) {
        try {
          history = await prepareHistory(promptText, turn.eventId);
        } catch (error) {
          // The tool already ran, so changing native sessions must never replay this input.
          if (
            error instanceof HistoryTranscriptBudgetError ||
            error instanceof ProviderContextRecoveryError
          )
            throw new AgentError('invalid_request', error.message, {
              cause: error,
              delivery: 'accepted',
            });
          throw error;
        }
      }

      const finalEmbeddedContext = [history.context, instructions]
        .filter(Boolean)
        .join('\n\n---\n\n');
      if (history.context)
        await this.eventRepository.append(
          this.sessionId,
          'status',
          {
            status: 'context_handoff',
            title: `Transferred conversation context to ${sessionRecord?.selectedProvider ?? 'agent'}`,
            strategy: history.strategy,
          },
          turn.eventId,
          { attemptId },
        );

      const snapshotService = this.runtimeRegistry?.getCheckpointService?.();

      this.claimDispatch(accepted?.attemptId);
      history.pending();
      pendingHistory = history;
      diagnostics.dispatch();
      observation.phase('dispatched');
      const promptResult = await this.runtimeHandle.prompt(
        promptText,
        resolvedAttachmentFiles,
        finalEmbeddedContext || undefined,
      );
      const timings = diagnostics.finish();
      const foregroundFailure =
        promptResult.stopReason === 'error'
          ? normalizeChatError(
              promptResult.error ?? { message: 'The agent reported a foreground error.' },
              {
                stage: 'stream',
                attemptId,
                eventId: turn.eventId,
                providerId: sessionRecord?.selectedProvider,
              },
            )
          : undefined;
      if (foregroundFailure)
        this.logger.error(promptResult.error, 'Provider foreground execution failed');

      if (
        this.deps.isStopped() ||
        (this.runtimeRegistry?.ownsRuntime &&
          !this.runtimeRegistry.ownsRuntime(this.sessionId, this.deps.runtimeId))
      )
        throw new Error('Turn ended after its runtime was retired');
      skills.delivered();
      await this.projector.flushAll();
      await this.projector.finalizeInFlightToolCalls(
        promptResult.stopReason === 'cancelled'
          ? 'cancelled'
          : promptResult.stopReason === 'error'
            ? 'failed'
            : 'unknown',
      );

      const turnData: Record<string, unknown> = {
        status: 'turn_end',
        stopReason: promptResult.stopReason,
        timings,
        ...(foregroundFailure ? { error: foregroundFailure } : {}),
      };

      if (snapshotService && this.cwd && snapshotService.getTurnChanges) {
        try {
          if (startSnapshotHash) {
            const endSnapshotHash = await snapshotService.track(this.cwd);
            if (endSnapshotHash) {
              const turnChanges = await snapshotService.getTurnChanges(
                this.cwd,
                startSnapshotHash,
                endSnapshotHash,
              );
              if (turnChanges) {
                turnData.turnChanges = turnChanges;
              }
            }
          }
        } catch (e: unknown) {
          this.logger.error(e, 'Failed to compute turn changes');
        }
      }

      if (promptResult.usage) {
        const metrics: AgentUsage = promptResult.usage;
        if (metrics) {
          turnData.usage = metrics;

          const sessionRecord = await this.store.session(this.sessionId);
          if (sessionRecord) {
            const existingMetrics = jsonCodecs.unknownRecord(sessionRecord.sessionMetrics);

            const currentInput =
              typeof existingMetrics.inputTokens === 'number' ? existingMetrics.inputTokens : 0;
            const currentOutput =
              typeof existingMetrics.outputTokens === 'number' ? existingMetrics.outputTokens : 0;

            const newInput = currentInput + (metrics.inputTokens ?? 0);
            const newOutput = currentOutput + (metrics.outputTokens ?? 0);
            const newTotal = Math.max(0, metrics.totalTokens ?? newInput + newOutput);
            // Context reports own both occupancy and capacity. Prompt consumption
            // metadata must not replace that report, including an unknown capacity.
            const effectiveLimit =
              sessionRecord.contextUsedTokens !== null
                ? sessionRecord.contextLimit
                : metrics.contextLimit && metrics.contextLimit > 0
                  ? metrics.contextLimit
                  : sessionRecord.contextLimit > 0
                    ? sessionRecord.contextLimit
                    : typeof existingMetrics.contextLimit === 'number' &&
                        existingMetrics.contextLimit > 0
                      ? existingMetrics.contextLimit
                      : 0;
            const newContextLimit =
              effectiveLimit > 0 ? effectiveLimit : sessionRecord.contextLimit;

            const updatedMetrics = {
              ...existingMetrics,
              inputTokens: newInput,
              outputTokens: newOutput,
              totalTokens: newTotal,
              ...(newContextLimit > 0 ? { contextLimit: newContextLimit } : {}),
              lastTurn: { ...metrics, cost: normalizeReportedCost(metrics.cost) },
            };

            const sessionUpdate: Record<string, unknown> = {
              totalTokens: newTotal,
              sessionMetrics: JSON.stringify(updatedMetrics),
              updatedAt: new Date(),
            };
            if (newContextLimit > 0) {
              sessionUpdate.contextLimit = newContextLimit;
            }

            await this.db
              .update(sessions)
              .set(sessionUpdate)
              .where(eq(sessions.id, this.sessionId));
          }
        } else {
          turnData.usage = promptResult.usage;
        }
      }
      if (accepted) {
        await this.store.finishAttempt(
          accepted.attemptId,
          promptResult.stopReason === 'cancelled'
            ? 'cancelled'
            : promptResult.stopReason === 'error'
              ? 'failed'
              : 'completed',
        );
      }
      if (promptResult.userMessageId) {
        await this.eventRepository.update(turn.eventId, { messageId: promptResult.userMessageId });
        turnData.userMessageId = promptResult.userMessageId;
      }
      await this.eventRepository.append(this.sessionId, 'status', turnData, turn.eventId, {
        attemptId,
      });
      if (foregroundFailure)
        await this.recordFailure(attemptId, turn.eventId, foregroundFailure, timings);
      history.delivered(
        turn.eventId,
        Buffer.byteLength(JSON.stringify(promptText)) +
          Buffer.byteLength(JSON.stringify(finalEmbeddedContext)) +
          attachmentContextAllowance(attachmentMimeTypes),
      );

      await this.returnToIdle();
      outcome =
        promptResult.stopReason === 'cancelled'
          ? 'cancelled'
          : foregroundFailure
            ? 'error'
            : 'success';
    } catch (error: unknown) {
      if (
        error instanceof AgentError &&
        (error.delivery === 'rejected' || error.delivery === 'not_sent')
      )
        pendingHistory?.unsent();
      if (
        !this.deps.isStopped() &&
        (error instanceof TurnCancelledBeforeDispatch || activeTurn.cancelled)
      ) {
        outcome = 'cancelled';
        if (accepted) this.store.finishAttempt(attemptId, 'cancelled');
        const eventId = this.diagnosticTurn?.eventId;
        if (eventId !== undefined) {
          if (
            accepted &&
            !executedMcpCommand &&
            error instanceof AgentError &&
            error.delivery === 'not_sent'
          )
            await this.eventRepository.update(eventId, undispatchedCancellation, undefined, [
              'deliveryFailure',
            ]);
          await this.eventRepository.append(
            this.sessionId,
            'status',
            { status: 'turn_end', stopReason: 'cancelled', timings: diagnostics.finish() },
            eventId,
            { attemptId },
          );
        }
        await this.returnToIdle();
        return;
      }
      if (
        error instanceof ProviderContextRecoveryError ||
        error instanceof HistoryTranscriptBudgetError
      )
        throw error;
      if (
        this.runtimeRegistry?.ownsRuntime &&
        !this.runtimeRegistry.ownsRuntime(this.sessionId, this.deps.runtimeId)
      )
        throw error;
      if (
        accepted &&
        !this.db
          .select({ id: sessionOperations.id })
          .from(sessionTurnAttempts)
          .innerJoin(sessionOperations, eq(sessionOperations.id, sessionTurnAttempts.operationId))
          .where(
            and(eq(sessionTurnAttempts.id, attemptId), eq(sessionOperations.status, 'running')),
          )
          .get()
      )
        throw error;
      const timings = diagnostics.finish();
      await this.projector.flushAll().catch((flushError: unknown) => {
        this.logger.error(flushError, 'Failed to flush events after prompt error');
      });
      if (accepted) {
        // The durable worker owns delivery classification and the visible failure event.
        await this.eventRepository
          .append(
            this.sessionId,
            'status',
            {
              status: 'turn_end',
              stopReason: 'error',
              timings,
            },
            accepted.eventId,
            { attemptId },
          )
          .catch((eventError: unknown) => {
            this.logger.error(eventError, 'Failed to record prompt timings');
          });
      } else {
        const failure = normalizeChatError(error, {
          stage:
            timings.acceptanceMs !== undefined || timings.firstOutputMs !== undefined
              ? 'stream'
              : timings.completionMs !== undefined
                ? 'dispatch'
                : 'prepare',
          attemptId,
          eventId: this.diagnosticTurn?.eventId,
        });
        await this.recordFailure(attemptId, this.diagnosticTurn?.eventId, failure, timings).catch(
          (eventError: unknown) => {
            this.logger.error(eventError, 'Failed to record prompt error');
          },
        );
      }
      if (this.deps.isStopped()) throw error;
      await this.deps.onError(error).catch((handleError: unknown) => {
        this.logger.error(handleError, 'Failed to update session after prompt error');
      });
      throw error;
    } finally {
      observation.finish(this.deps.isStopped() ? 'cancelled' : outcome, diagnostics.finish());
      this.permissionEngine.clearTurn();
      this.diagnosticTurn = undefined;
      this.deps.endAttempt();
      this.activeTurn = undefined;
    }
  }
}
