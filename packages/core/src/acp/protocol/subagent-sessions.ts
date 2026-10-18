import type { SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  UpdateSessionNotification,
  SessionUpdate as V2SessionUpdate,
} from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentSessionCallbacks, AgentSubagentAssociation } from '../../agent/types.js';
import {
  ACP_MAX_DIRECTED_MESSAGES,
  ACP_MAX_SUBAGENT_BYTES,
  ACP_MAX_SUBAGENTS,
  acpPayloadBytes,
} from '../transport/limits.js';
import { displayAcpContent } from './content.js';

/** SDK-owned child updates shared by the v1 and v2 adapters. */
type NativeSubagentNotification<T> = {
  sessionId: string;
  update: Extract<
    T,
    {
      sessionUpdate: 'subagent_update' | 'session_message' | 'session_message_chunk';
    }
  >;
};

export type SubagentNotification =
  | NativeSubagentNotification<SessionUpdate>
  | NativeSubagentNotification<V2SessionUpdate>;

export function isSubagentNotification(
  notification: SessionNotification | UpdateSessionNotification,
): notification is SubagentNotification {
  const kind = notification.update.sessionUpdate;
  return (
    kind === 'subagent_update' || kind === 'session_message' || kind === 'session_message_chunk'
  );
}

interface SessionContext {
  callbacks: AgentSessionCallbacks;
}
interface Child {
  rootSessionId: string;
  association: AgentSubagentAssociation;
  context?: SessionContext;
  bytes: number;
}
interface DirectedMessage {
  rootSessionId: string;
  senderSessionId?: string;
  recipientSessionId?: string;
  content: string;
  bytes: number;
  metadata?: Record<string, unknown> | null;
}

/** One ownership tree per connection. Participant links never establish ownership. */
export class AcpSubagentSessions<T extends SessionContext> {
  private children = new Map<string, Child>();
  private messages = new Map<string, DirectedMessage>();
  private bytes = 0;
  constructor(
    private resolveRoot: (sessionId: string) => T,
    private readonly limits = {
      children: ACP_MAX_SUBAGENTS,
      messages: ACP_MAX_DIRECTED_MESSAGES,
      bytes: ACP_MAX_SUBAGENT_BYTES,
    },
  ) {}

  snapshot() {
    return { children: this.children.size, messages: this.messages.size, bytes: this.bytes };
  }

  private account(previous: number, next: number): void {
    if (next > this.limits.bytes - this.bytes + previous)
      throw new Error('ACP subagent byte budget exceeded');
    this.bytes += next - previous;
  }

  /** Remove ownership and content for one root without disturbing sibling roots. */
  releaseRoot(rootSessionId: string): Set<AgentSessionCallbacks> {
    const callbacks = new Set<AgentSessionCallbacks>();
    for (const [id, child] of this.children) {
      if (child.rootSessionId !== rootSessionId) continue;
      if (child.context) callbacks.add(child.context.callbacks);
      this.bytes -= child.bytes;
      this.children.delete(id);
      this.sources.delete(id);
    }
    for (const [id, message] of this.messages) {
      if (message.rootSessionId !== rootSessionId) continue;
      this.bytes -= message.bytes;
      this.messages.delete(id);
    }
    return callbacks;
  }

  rootSessionId(sessionId: string): string {
    return this.children.get(sessionId)?.rootSessionId ?? sessionId;
  }

  isChild(sessionId: string): boolean {
    return this.children.has(sessionId);
  }

  resolve(sessionId: string): T {
    const child = this.children.get(sessionId);
    if (!child) return this.resolveRoot(sessionId);
    const root = this.resolveRoot(child.rootSessionId); // Recheck liveness on every request.
    if (!child.context || this.sources.get(sessionId) !== root.callbacks) {
      // Cache the wrapper independently of root callbacks for terminal ownership and tool metadata.
      const callbacks: AgentSessionCallbacks = {
        onUpdate: (event) =>
          root.callbacks.onUpdate({ type: 'subagent_event', subagentId: sessionId, event }),
        onRequestPermission: (request, signal) =>
          root.callbacks.onRequestPermission({ ...request, subagentId: sessionId }, signal),
        ...(root.callbacks.onRequestElicitation
          ? {
              onRequestElicitation: (request, signal) =>
                root.callbacks.onRequestElicitation!({ ...request, subagentId: sessionId }, signal),
            }
          : {}),
        onElicitationCompleted: (id) => root.callbacks.onElicitationCompleted?.(id),
      };
      child.context = { ...root, callbacks };
      // Remember the source separately; wrapper identity must stay stable.
      this.sources.set(sessionId, root.callbacks);
    }
    return child.context as T;
  }
  private sources = new Map<string, AgentSessionCallbacks>();

  async update(notification: SubagentNotification, historical = false): Promise<void> {
    const { sessionId: parent, update } = notification;
    const context = this.resolve(parent);
    if (update.sessionUpdate === 'subagent_update') {
      const id = update.sessionId;
      const existing = this.children.get(id);
      if (!existing && this.children.size >= this.limits.children)
        throw new Error('ACP subagent entity limit exceeded');
      if (id === parent || (existing && existing.association.parentSessionId !== parent))
        throw new Error('Invalid ACP child session ownership');
      if (!existing) {
        let ancestor: string | undefined = parent;
        while (ancestor) {
          if (ancestor === id) throw new Error('Cyclic ACP child session ownership');
          ancestor = this.children.get(ancestor)?.association.parentSessionId;
        }
        // A registered ordinary session cannot be converted into a child.
        try {
          this.resolveRoot(id);
          throw new Error('ACP child ID is already a root session');
        } catch (error) {
          if (error instanceof Error && error.message === 'ACP child ID is already a root session')
            throw error;
        }
      }
      const association: AgentSubagentAssociation = existing
        ? { ...existing.association }
        : {
            subagentId: id,
            parentSessionId: parent,
          };
      if (association.historical && !historical) {
        // Replay snapshots do not become current merely because a label changed.
        association.state = null;
        association.capabilities = null;
      }
      for (const key of ['title', 'description', 'capabilities', 'state'] as const) {
        if (update[key] !== undefined) Object.assign(association, { [key]: update[key] });
      }
      association.historical = historical;
      const bytes = acpPayloadBytes(association);
      this.account(existing?.bytes ?? 0, bytes);
      this.children.set(id, {
        ...existing,
        association,
        rootSessionId: this.rootSessionId(parent),
        bytes,
      });
      await this.resolveRoot(this.rootSessionId(parent)).callbacks.onUpdate({
        type: 'subagent_update',
        association: { ...association },
      });
      return;
    }
    const key = JSON.stringify([parent, update.messageId]);
    const stored = this.messages.get(key);
    if (!stored && this.messages.size >= this.limits.messages)
      throw new Error('ACP directed message entity limit exceeded');
    const previous = stored ?? { content: '', bytes: 0, rootSessionId: this.rootSessionId(parent) };
    const message = { ...previous };
    for (const field of ['senderSessionId', 'recipientSessionId'] as const) {
      const id = update[field];
      if (!id) continue;
      if (message[field] && message[field] !== id)
        throw new Error('ACP message participant changed');
      this.resolve(id); // Live participant IDs must already be announced.
      message[field] = id;
    }
    if (
      message.senderSessionId &&
      message.recipientSessionId &&
      (message.senderSessionId === message.recipientSessionId ||
        (parent !== message.senderSessionId && parent !== message.recipientSessionId))
    )
      throw new Error('Invalid ACP message participants');
    let chunk: string | undefined;
    if (update.sessionUpdate === 'session_message_chunk') {
      chunk = displayAcpContent(update.content);
      message.content += chunk;
    } else {
      if (update.content !== undefined)
        message.content = update.content?.map(displayAcpContent).join('') ?? '';
      if (update._meta !== undefined) message.metadata = update._meta;
    }
    message.bytes =
      stored &&
      chunk !== undefined &&
      message.senderSessionId === stored.senderSessionId &&
      message.recipientSessionId === stored.recipientSessionId
        ? stored.bytes + acpPayloadBytes(chunk) - 2
        : acpPayloadBytes({ ...message, bytes: undefined });
    this.account(previous.bytes, message.bytes);
    this.messages.set(key, message);
    await context.callbacks.onUpdate({
      type: 'session_message',
      messageId: update.messageId,
      transcriptSessionId: parent,
      senderSessionId: message.senderSessionId,
      recipientSessionId: message.recipientSessionId,
      content: message.content,
      metadata: message.metadata,
    });
  }

  async state(
    sessionId: string,
    state: { state: string; [key: string]: unknown },
    historical = false,
  ) {
    const child = this.children.get(sessionId);
    if (!child) return;
    const association = {
      ...child.association,
      ...(child.association.historical && !historical ? { capabilities: null } : {}),
      state,
      historical,
    };
    const bytes = acpPayloadBytes(association);
    this.account(child.bytes, bytes);
    child.association = association;
    child.bytes = bytes;
    await this.resolveRoot(child.rootSessionId).callbacks.onUpdate({
      type: 'subagent_update',
      association: { ...child.association },
    });
  }

  clear() {
    this.children.clear();
    this.messages.clear();
    this.sources.clear();
    this.bytes = 0;
  }
}
