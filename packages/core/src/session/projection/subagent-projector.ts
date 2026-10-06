import type { AgentSubagentAssociation, AgentUpdate } from '../../agent/types.js';
import type { SessionEventRepositoryLike } from '../contracts.js';
import { ConversationProjector } from './conversation-projector.js';
import { noopLogger, type Logger } from '../../logger.js';
import type { SessionEventPayload, SessionEventSubagentUpdateData } from '@agentctl/shared';

/** Child conversations share the local event store, never the parent's mutable session settings. */
export class SubagentProjector {
  private children = new Map<string, { eventId: number; conversation: ConversationProjector }>();
  private messages = new Map<string, number>();
  constructor(
    private sessionId: string,
    private repository: SessionEventRepositoryLike,
    private parentEventId: () => number | null,
    private logger: Logger = noopLogger,
  ) {}

  parentFor(subagentId?: string): number | null {
    return subagentId ? (this.children.get(subagentId)?.eventId ?? null) : this.parentEventId();
  }

  async association(association: AgentSubagentAssociation): Promise<void> {
    const { subagentId, state, historical } = association;
    const status: SessionEventSubagentUpdateData['status'] = historical
      ? 'unknown'
      : state?.state === 'requires_action'
        ? 'waiting'
        : state?.state === 'running' || state?.state === 'idle'
          ? state.state
          : 'unknown';
    const data: SessionEventPayload<'subagent_update'> = {
      subagentId,
      native: true,
      parentSessionId: association.parentSessionId,
      name: association.title ?? 'Subagent',
      scope: association.description ?? '',
      status,
      historical,
      state: state ?? null,
      capabilities: historical ? null : (association.capabilities ?? null),
    };
    const existing = this.children.get(subagentId);
    if (existing) {
      await this.repository.update(existing.eventId, data);
      return;
    }
    const eventId = await this.repository.append(
      this.sessionId,
      'subagent_update',
      data,
      this.children.get(association.parentSessionId)?.eventId ?? this.parentEventId(),
    );
    const scope = { nativeSessionId: subagentId };
    const scoped: SessionEventRepositoryLike = {
      append: (id, type, payload, parent, metadata) =>
        this.repository.append(id, type, payload, parent ?? eventId, { ...metadata, ...scope }),
      getEvent: (id) => this.repository.getEvent(id),
      update: (id, payload, metadata, clear) =>
        this.repository.update(id, payload, { ...metadata, ...scope }, clear),
      updateSilently: (id, payload, metadata) =>
        this.repository.updateSilently(id, payload, { ...metadata, ...scope }),
      // Opaque IDs may collide across parent and child transcripts.
      findMessage: (id, role, messageId) =>
        this.repository.findMessage?.(id, role, messageId, subagentId) ??
        Promise.resolve(undefined),
      publishTransient: (row, delta) =>
        this.repository.publishTransient(
          {
            ...row,
            parentEventId: row.parentEventId ?? eventId,
            metadata: JSON.stringify({ ...JSON.parse(row.metadata ?? '{}'), ...scope }),
          },
          delta,
        ),
    };
    this.children.set(subagentId, {
      eventId,
      conversation: new ConversationProjector(this.sessionId, scoped, this.logger),
    });
    this.children.get(subagentId)!.conversation.setCurrentParentEventId(eventId);
  }

  async message(
    event: Extract<AgentUpdate, { type: 'session_message' }>,
    subagentId?: string,
  ): Promise<void> {
    const messageId = JSON.stringify([event.transcriptSessionId, event.messageId]);
    const data: SessionEventPayload<'text'> = {
      role: 'session',
      content: event.content,
      messageId,
      transcriptSessionId: event.transcriptSessionId,
      senderSessionId: event.senderSessionId,
      recipientSessionId: event.recipientSessionId,
    };
    let eventId = this.messages.get(messageId);
    eventId ??= (
      await this.repository.findMessage?.(this.sessionId, 'session', messageId, subagentId)
    )?.eventId;
    const metadata = {
      ...(subagentId ? { nativeSessionId: subagentId } : {}),
      sessionMessageMetadata: event.metadata ?? null,
    };
    if (eventId) await this.repository.update(eventId, data, metadata);
    else
      eventId = await this.repository.append(
        this.sessionId,
        'text',
        data,
        this.parentFor(subagentId),
        metadata,
      );
    this.messages.set(messageId, eventId);
  }

  async activity(subagentId: string, event: AgentUpdate): Promise<void> {
    const child = this.children.get(subagentId);
    if (!child) throw new Error('ACP child activity preceded its association');
    const conversation = child.conversation;
    const messageId = 'messageId' in event ? event.messageId : undefined;
    switch (event.type) {
      case 'session_message':
        await this.message(event, subagentId);
        break;
      case 'text':
        await conversation.appendText(event.text, messageId, event.operation);
        break;
      case 'thought':
        await conversation.appendThought(event.text, messageId, event.operation);
        break;
      case 'user_text':
        await conversation.appendUserText(event.text, messageId, event.operation);
        break;
      case 'tool_call':
        await conversation.upsertToolCall(event.call, event.contentOperation, event.clearFields);
        break;
      case 'terminal_created':
      case 'terminal_output':
      case 'terminal_exit':
        await this.repository.append(this.sessionId, event.type, event, child.eventId, {
          nativeSessionId: subagentId,
        });
        break;
      case 'plan_update':
        await this.repository.append(
          this.sessionId,
          'plan_update',
          { plan: event.plan, artifacts: event.artifact ? [event.artifact] : [] },
          child.eventId,
          { nativeSessionId: subagentId },
        );
        break;
      default:
        // Keep settings, usage and unfamiliar child state observable without updating the root session table.
        await this.repository.append(
          this.sessionId,
          'status',
          { ...event, status: event.type === 'status' ? event.status : event.type },
          child.eventId,
          { nativeSessionId: subagentId },
        );
    }
  }

  async flushAll() {
    await Promise.all([...this.children.values()].map((child) => child.conversation.flushAll()));
  }
  async finalizeInFlightToolCalls() {
    await Promise.all(
      [...this.children.values()].map((child) =>
        child.conversation.finalizeInFlightToolCalls('unknown'),
      ),
    );
  }
  getTransientSnapshots() {
    return [...this.children.entries()].flatMap(([id, child]) =>
      child.conversation.getTransientSnapshots().map((row) => ({
        ...row,
        metadata: JSON.stringify({ ...JSON.parse(row.metadata ?? '{}'), nativeSessionId: id }),
      })),
    );
  }
}
