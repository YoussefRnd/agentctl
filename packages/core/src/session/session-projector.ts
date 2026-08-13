import type { DbClient } from '../db/index.js';
import { sessions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Logger } from '../logger.js';
import { noopLogger } from '../logger.js';
import type { DomainAgentEvent, SessionEventStoreLike, SnapshotServiceLike } from '../acp/types.js';
import { EventStreamAdapter } from './event-stream-adapter.js';

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

  async startTurn(text: string, attachments?: unknown[], promptTokens?: number): Promise<number> {
    return this.adapter.startTurn(text, attachments, promptTokens);
  }

  async appendText(text: string): Promise<void> {
    return this.adapter.appendText(text);
  }

  async appendThought(text: string): Promise<void> {
    return this.adapter.appendThought(text);
  }

  async registerToolCall(call: unknown, isUpdate: boolean): Promise<void> {
    return this.adapter.registerToolCall(call, isUpdate);
  }

  async flushAll(): Promise<void> {
    return this.adapter.flushAll();
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

  async handleDomainEvent(event: DomainAgentEvent): Promise<void> {
    switch (event.type) {
      case 'tool_call':
        await this.adapter.registerToolCall(event.call, event.isUpdate);
        break;
      case 'text':
        await this.adapter.appendText(event.text);
        break;
      case 'thought':
        await this.adapter.appendThought(event.text);
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
        const metricsPayload = {
          totalTokens: event.used,
          contextLimit: event.size,
          cost: event.cost ?? null,
          lastUpdated: new Date().toISOString(),
        };

        await this.db
          .update(sessions)
          .set({
            totalTokens: event.used,
            contextLimit: event.size,
            estimatedCost: event.cost ? event.cost.amount : 0.0,
            sessionMetrics: JSON.stringify(metricsPayload),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, this.sessionId));

        await this.eventStore.append(
          this.sessionId,
          'status',
          {
            status: 'usage_update',
            totalTokens: event.used,
            contextLimit: event.size,
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
