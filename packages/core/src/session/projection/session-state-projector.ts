import { SubagentProjector } from './subagent-projector.js';
import type { DbClient } from '../../db/index.js';
import { sessions, providers } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Logger } from '../../logger.js';
import { noopLogger } from '../../logger.js';
import type { SessionEventRepositoryLike, CheckpointServiceLike } from '../contracts.js';
import type { AgentUpdate } from '../../agent/types.js';
import { deriveAgentToolEffects } from '../../agent/tool-effects.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import { ConversationProjector } from './conversation-projector.js';
import {
  withCustomModels,
  decodeCustomModels,
  planArtifactSchema,
  findAgentConfigOption,
  isThinkingEffort,
  type SessionEventPayload,
} from '@agentctl/shared';

/**
 * Owns the persistence side of an ACP session: maps incoming domain events
 * into event-store rows + session table updates, and provides the buffered
 * transcript adapter used by the prompt pipeline.
 */
export class SessionStateProjector {
  private activeAttemptId: string | undefined;
  readonly conversation: ConversationProjector;
  readonly subagents: SubagentProjector;

  constructor(
    private sessionId: string,
    private db: DbClient,
    private eventRepository: SessionEventRepositoryLike,
    private logger: Logger = noopLogger,
    cwd?: string,
    snapshotService?: CheckpointServiceLike,
    private canProject: () => boolean = () => true,
  ) {
    this.subagents = new SubagentProjector(
      sessionId,
      eventRepository,
      () => this.getCurrentParentEventId(),
      logger,
    );
    this.conversation = new ConversationProjector(
      sessionId,
      eventRepository,
      logger,
      cwd,
      snapshotService,
    );
  }

  async startTurn(
    text: string,
    attachments?: NonNullable<SessionEventPayload<'text'>['attachments']>,
    promptTokens?: number,
    clientMessageId?: string,
    attachmentIds?: string[],
    acceptedEventId?: number,
    attemptId?: string,
  ): ReturnType<ConversationProjector['startTurn']> {
    this.activeAttemptId = attemptId;
    return this.conversation.startTurn(
      text,
      attachments,
      promptTokens,
      clientMessageId,
      attachmentIds,
      acceptedEventId,
      attemptId,
    );
  }

  async appendText(
    text: string,
    messageId?: string,
    operation?: 'append' | 'replace',
  ): Promise<void> {
    return this.conversation.appendText(text, messageId, operation);
  }

  async appendThought(
    text: string,
    messageId?: string,
    operation?: 'append' | 'replace',
  ): Promise<void> {
    return this.conversation.appendThought(text, messageId, operation);
  }

  async upsertToolCall(call: unknown, contentOperation?: 'replace' | 'append'): Promise<void> {
    return this.conversation.upsertToolCall(call, contentOperation);
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.conversation.flushAll(), this.subagents.flushAll()]);
  }

  async finalizeInFlightToolCalls(
    status: 'unknown' | 'cancelled' | 'interrupted' | 'failed' = 'unknown',
  ): Promise<void> {
    return this.conversation.finalizeInFlightToolCalls(status);
  }

  getCurrentParentEventId(): number | null {
    return this.conversation.getCurrentParentEventId();
  }

  getTransientSnapshots(): ReturnType<ConversationProjector['getTransientSnapshots']> {
    return [
      ...this.conversation.getTransientSnapshots(),
      ...this.subagents.getTransientSnapshots(),
    ];
  }

  setCurrentParentEventId(id: number | null): void {
    this.conversation.setCurrentParentEventId(id);
  }

  private appendEvent(...args: Parameters<SessionEventRepositoryLike['append']>): Promise<number> {
    const [sessionId, type, data, parentId, metadata] = args;
    return this.eventRepository.append(
      sessionId,
      type,
      data,
      parentId,
      this.activeAttemptId ? { ...metadata, attemptId: this.activeAttemptId } : metadata,
    );
  }

  async handleDomainEvent(event: AgentUpdate): Promise<void> {
    if (!this.canProject()) return;
    switch (event.type) {
      case 'context_compacted':
        // Lifecycle signal; the accompanying tool call carries the visible summary.
        break;
      case 'notice':
        this.eventRepository.publishNotice?.({ ...event, sessionId: this.sessionId });
        break;
      case 'subagent_update':
        await this.subagents.association(event.association);
        break;
      case 'subagent_event':
        await this.subagents.activity(event.subagentId, event.event);
        break;
      case 'session_message':
        await this.subagents.message(event);
        break;
      case 'tool_call': {
        const effects = event.call.effects ?? deriveAgentToolEffects(event.call);
        await this.conversation.upsertToolCall(
          {
            ...event.call,
            ...(effects.length > 0 ? { effects } : {}),
          },
          event.contentOperation,
          event.clearFields,
        );
        break;
      }
      case 'user_message_unconfirmed':
        this.conversation.clearPendingUserMessage();
        break;
      case 'user_message_accepted':
        await this.conversation.acceptUserMessage(event.messageId);
        break;
      case 'user_text':
        await this.conversation.appendUserText(event.text, event.messageId, event.operation);
        break;
      case 'text':
        await this.conversation.appendText(event.text, event.messageId, event.operation);
        break;
      case 'thought':
        await this.conversation.appendThought(event.text, event.messageId, event.operation);
        break;
      case 'status':
        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: event.status,
            title: event.title,
          },
          null,
        );
        break;
      case 'usage_update': {
        const sanitizedUsed = Math.max(0, event.used);
        const sanitizedSize = Math.max(0, event.size);

        const sessionRecord = await this.db.query.sessions.findFirst({
          where: eq(sessions.id, this.sessionId),
        });
        if (!this.canProject()) return;

        const existingMetrics = jsonCodecs.unknownRecord(sessionRecord?.sessionMetrics);

        const effectiveContextLimit =
          sanitizedSize > 0
            ? sanitizedSize
            : sessionRecord?.contextLimit && sessionRecord.contextLimit > 0
              ? sessionRecord.contextLimit
              : typeof existingMetrics.contextLimit === 'number' && existingMetrics.contextLimit > 0
                ? existingMetrics.contextLimit
                : 0;

        const metricsPayload = {
          ...existingMetrics,
          totalTokens: sanitizedUsed,
          ...(effectiveContextLimit > 0 ? { contextLimit: effectiveContextLimit } : {}),
          cost: event.cost ?? existingMetrics.cost ?? null,
          lastUpdated: new Date().toISOString(),
        };

        const updateSet: Record<string, unknown> = {
          totalTokens: sanitizedUsed,
          estimatedCost: event.cost ? event.cost.amount : (sessionRecord?.estimatedCost ?? 0.0),
          sessionMetrics: JSON.stringify(metricsPayload),
          updatedAt: new Date(),
        };

        if (effectiveContextLimit > 0) {
          updateSet.contextLimit = effectiveContextLimit;
        }

        this.db.update(sessions).set(updateSet).where(eq(sessions.id, this.sessionId)).run();

        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: 'usage_update',
            totalTokens: sanitizedUsed,
            contextLimit: effectiveContextLimit > 0 ? effectiveContextLimit : undefined,
            cost: event.cost ?? undefined,
          },
          null,
        );
        break;
      }
      case 'available_commands_update':
        this.db
          .update(sessions)
          .set({
            availableCommands: JSON.stringify(event.commands),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId))
          .run();

        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: 'available_commands_update',
            availableCommands: event.commands,
          },
          null,
        );
        break;
      case 'plan_update': {
        const sanitizedPlan = Array.isArray(event.plan)
          ? event.plan.map((item) => ({
              name: item.name || 'unnamed task',
              status: item.status,
              isCompleted: item.isCompleted,
              priority: item.priority,
            }))
          : [];

        const record = await this.db.query.sessions.findFirst({
          where: eq(sessions.id, this.sessionId),
        });
        if (!this.canProject()) return;
        let stored: unknown = [];
        try {
          stored = JSON.parse(record?.planArtifacts ?? '[]');
        } catch {
          /* Legacy/invalid state. */
        }
        const parsed = planArtifactSchema.array().safeParse(stored);
        let artifacts = parsed.success ? parsed.data : [];
        if (event.removedPlanId)
          artifacts = artifacts.filter((artifact) => artifact.id !== event.removedPlanId);
        else if (event.artifact) {
          artifacts = [
            ...artifacts.filter((artifact) => artifact.id !== event.artifact!.id),
            event.artifact,
          ].slice(-16);
        } else artifacts = [];
        const effectivePlan =
          event.artifact || event.removedPlanId
            ? artifacts
                .filter((artifact) => artifact.kind === 'items')
                .flatMap((artifact) => artifact.items ?? [])
            : sanitizedPlan;
        this.db
          .update(sessions)
          .set({
            planArtifacts: JSON.stringify(artifacts),
            plan: JSON.stringify(effectivePlan),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId))
          .run();

        await this.appendEvent(
          this.sessionId,
          'plan_update',
          {
            plan: effectivePlan,
            artifacts,
          },
          null,
        );
        break;
      }
      case 'metrics_update':
        this.db
          .update(sessions)
          .set({
            sessionMetrics: JSON.stringify(event.metrics),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId))
          .run();
        break;
      case 'config_option_update': {
        const sessionRecord = await this.db.query.sessions.findFirst({
          where: eq(sessions.id, this.sessionId),
        });
        const provider = sessionRecord
          ? await this.db.query.providers.findFirst({
              where: eq(providers.id, sessionRecord.selectedProvider),
            })
          : undefined;
        if (!this.canProject()) return;
        const configOptions = withCustomModels(
          event.configOptions,
          decodeCustomModels(provider?.customModels),
        );
        const thinkingValue = findAgentConfigOption(configOptions, 'thought_level')?.currentValue;
        this.db
          .update(sessions)
          .set({
            sessionConfigOptions: JSON.stringify(configOptions),
            selectedThinkingEffort: isThinkingEffort(thinkingValue) ? thinkingValue : null,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId))
          .run();

        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: 'config_option_update',
            configOptions,
          },
          null,
        );
        break;
      }
      case 'terminal_created':
        await this.appendEvent(
          this.sessionId,
          'terminal_created',
          {
            terminalId: event.terminalId,
            command: event.command,
          },
          null,
        );
        break;
      case 'terminal_output':
        await this.appendEvent(
          this.sessionId,
          'terminal_output',
          {
            terminalId: event.terminalId,
            data: event.data,
            operation: event.operation,
          },
          null,
        );
        break;
      case 'terminal_exit':
        await this.appendEvent(
          this.sessionId,
          'terminal_exit',
          {
            terminalId: event.terminalId,
            code: event.code,
          },
          null,
        );
        break;
      case 'mode_update': {
        this.db
          .update(sessions)
          .set({
            agentPersona: event.modeId,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId))
          .run();

        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: 'mode_update',
            modeId: event.modeId,
          },
          null,
        );
        break;
      }
      case 'session_info_update': {
        const updateObj: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (typeof event.title === 'string') {
          updateObj.title = event.title;
        }
        this.db.update(sessions).set(updateObj).where(eq(sessions.id, this.sessionId)).run();

        await this.appendEvent(
          this.sessionId,
          'status',
          {
            status: 'session_info_update',
            title: event.title,
            updatedAt: event.updatedAt,
            ...(event.retry !== undefined ? { retry: event.retry } : {}),
          },
          null,
        );
        break;
      }
    }
  }
}
