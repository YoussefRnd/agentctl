import type { DbClient } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import type { SessionEventStoreLike, SnapshotServiceLike } from './contracts.js';
import type { AgentUpdate } from '../agent/types.js';
import { deriveAgentToolEffects } from '../agent/tool-effects.js';
import { jsonCodecs } from '../db/json-codecs.js';
import { EventStreamAdapter } from './event-stream-adapter.js';
import type { SessionEventPayload } from '@agentctl/shared';

/**
 * Owns the persistence side of an ACP session: maps incoming domain events
 * into event-store rows + session table updates, and provides the buffered
 * transcript adapter used by the prompt pipeline.
 */
export class SessionProjector {
  readonly adapter: EventStreamAdapter;

  constructor(
    private sessionId: string,
    private db: DbClient,
    private eventStore: SessionEventStoreLike,
    private logger: Logger = noopLogger,
    cwd?: string,
    snapshotService?: SnapshotServiceLike,
  ) {
    this.adapter = new EventStreamAdapter(sessionId, eventStore, logger, cwd, snapshotService);
  }

  async startTurn(
    text: string,
    attachments?: NonNullable<SessionEventPayload<'text'>['attachments']>,
    promptTokens?: number,
  ): ReturnType<EventStreamAdapter['startTurn']> {
    return this.adapter.startTurn(text, attachments, promptTokens);
  }

  async appendText(
    text: string,
    messageId?: string,
    operation?: 'append' | 'replace',
  ): Promise<void> {
    return this.adapter.appendText(text, messageId, operation);
  }

  async appendThought(
    text: string,
    messageId?: string,
    operation?: 'append' | 'replace',
  ): Promise<void> {
    return this.adapter.appendThought(text, messageId, operation);
  }

  async upsertToolCall(call: unknown, contentOperation?: 'replace' | 'append'): Promise<void> {
    return this.adapter.upsertToolCall(call, contentOperation);
  }

  async flushAll(): Promise<void> {
    return this.adapter.flushAll();
  }

  async finalizeInFlightToolCalls(): Promise<void> {
    return this.adapter.finalizeInFlightToolCalls();
  }

  getCurrentParentEventId(): number | null {
    return this.adapter.getCurrentParentEventId();
  }

  getTransientSnapshots(): ReturnType<EventStreamAdapter['getTransientSnapshots']> {
    return this.adapter.getTransientSnapshots();
  }

  setCurrentParentEventId(id: number | null): void {
    this.adapter.setCurrentParentEventId(id);
  }

  async handleDomainEvent(event: AgentUpdate): Promise<void> {
    switch (event.type) {
      case 'tool_call': {
        const effects = event.call.effects ?? deriveAgentToolEffects(event.call);
        await this.adapter.upsertToolCall(
          {
            ...event.call,
            ...(effects.length > 0 ? { effects } : {}),
          },
          event.contentOperation,
        );
        break;
      }
      case 'text':
        await this.adapter.appendText(event.text, event.messageId, event.operation);
        break;
      case 'thought':
        await this.adapter.appendThought(event.text, event.messageId, event.operation);
        break;
      case 'status':
        await this.eventStore.append(
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

        await this.db.update(sessions).set(updateSet).where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
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
        await this.db
          .update(sessions)
          .set({
            availableCommands: JSON.stringify(event.commands),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
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
              status: ['pending', 'in_progress', 'completed'].includes(item.status)
                ? item.status
                : 'pending',
              isCompleted: item.isCompleted,
              priority: item.priority,
            }))
          : [];

        await this.db
          .update(sessions)
          .set({
            plan: JSON.stringify(sanitizedPlan),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
          this.sessionId,
          'plan_update',
          {
            plan: sanitizedPlan,
          },
          null,
        );
        break;
      }
      case 'metrics_update':
        await this.db
          .update(sessions)
          .set({
            sessionMetrics: JSON.stringify(event.metrics),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));
        break;
      case 'config_option_update':
        await this.db
          .update(sessions)
          .set({
            sessionConfigOptions: JSON.stringify(event.configOptions),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
          this.sessionId,
          'status',
          {
            status: 'config_option_update',
            configOptions: event.configOptions,
          },
          null,
        );
        break;
      case 'terminal_created':
        await this.eventStore.append(
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
        await this.eventStore.append(
          this.sessionId,
          'terminal_output',
          {
            terminalId: event.terminalId,
            data: event.data,
          },
          null,
        );
        break;
      case 'terminal_exit':
        await this.eventStore.append(
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
        await this.db
          .update(sessions)
          .set({
            agentPersona: event.modeId,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
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
        await this.db.update(sessions).set(updateObj).where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
          this.sessionId,
          'status',
          {
            status: 'session_info_update',
            title: event.title,
            updatedAt: event.updatedAt,
          },
          null,
        );
        break;
      }
    }
  }
}
