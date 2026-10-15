import {
  methods,
  RequestError,
  type ClientConnection,
} from '@agentclientprotocol/sdk/experimental/v2';
import { findAgentConfigOption, withCustomModels } from '@agentctl/shared';
import type { ChildProcess } from 'node:child_process';
import { AgentError, AgentPromptRejectedError, normalizeAgentError } from '../../agent/errors.js';
import type {
  AgentPromptResult,
  AgentSession,
  AgentSessionCallbacks,
  AgentSessionOptions,
  AgentStopReason,
  AgentUpdate,
  AgentUsage,
} from '../../agent/types.js';
import {
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  getAgentRequestTimeoutMs,
} from '../../config/runtime-defaults.js';
import { buildPromptBlocks } from '../protocol/prompt.js';
import { bindSessionProcessEvents, withTimeout } from '../transport/acp-process-lifecycle.js';
import {
  ACP_SESSION_CLOSE_TIMEOUT_MS,
  ACP_SESSION_OPERATION_TIMEOUT_MS,
} from '../transport/limits.js';
import type { cancellableCallbacks } from '../transport/session-requests.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import type { AcpUpdateQueue } from '../transport/update-drain.js';
import type { AgentStreamTransport } from '../types.js';
import { advertised, productConfigOptions } from './capabilities.js';

export interface TurnStop {
  stopReason: AgentStopReason;
  usage?: AgentUsage;
  error?: AgentPromptResult['error'];
}

export interface ActiveCallbacks {
  callbacks: AgentSessionCallbacks;
  pendingInsertion?: Extract<AgentUpdate, { type: 'user_text' }>[];
  pendingInsertionBytes?: number;
  waiters: Array<{ resolve(value: TurnStop): void; reject(error: unknown): void }>;
}

interface SessionContext {
  options: AgentSessionOptions;
  child: ChildProcess;
  connection: ClientConnection;
  transport: AgentStreamTransport;
  capabilities: () => ReturnType<typeof advertised>;
  processEvents: ReturnType<typeof bindSessionProcessEvents>;
  requests: ReturnType<typeof cancellableCallbacks>;
  updates: AcpUpdateQueue;
  closedPromise: Promise<void>;
  sessions: Map<string, ActiveCallbacks>;
  rejectTurns: (error: unknown) => void;
  dropSession: (id: string) => void;
}
/** V2 acknowledges insertion first and finishes through foreground idle notifications. */
export function createV2Session(context: SessionContext): AgentSession {
  const {
    options,
    child,
    connection,
    transport,
    capabilities,
    processEvents,
    requests,
    updates,
    closedPromise,
    sessions,
    rejectTurns,
    dropSession,
  } = context;
  let closed = false;
  return {
    id: null,
    history: 'fresh',
    closed: closedPromise,
    onError: processEvents.onError,
    onClose: processEvents.onClose,
    async prompt(text, attachments, embeddedContext) {
      if (!this.id) throw new AgentError('invalid_request', 'Agent session has no ID');
      const active = sessions.get(this.id);
      if (!active) throw new AgentError('transport_lost', 'Agent session is not active');
      const blocks = await buildPromptBlocks({
        text,
        attachments,
        embeddedContext,
        supportsImage: capabilities().image,
        supportsAudio: capabilities().audio,
        supportsEmbeddedContext: capabilities().embeddedContext,
      });
      const stopPromise = new Promise<TurnStop>((resolve, reject) => {
        active.waiters.push({ resolve, reject });
      });
      void stopPromise.catch(() => undefined);
      active.pendingInsertion = [];
      active.pendingInsertionBytes = 0;
      let inserted = false;
      try {
        const accepted = await connection.agent.request(methods.agent.session.prompt, {
          sessionId: this.id,
          prompt: blocks,
        });
        inserted = true;
        await updates.enqueue(async () => {
          await active.callbacks.onUpdate({
            type: 'user_message_accepted',
            messageId: accepted.messageId,
          });
          for (const event of active.pendingInsertion ?? []) await active.callbacks.onUpdate(event);
          active.pendingInsertion = undefined;
          active.pendingInsertionBytes = 0;
        });
        const stop = await stopPromise;
        await updates.drain();
        return { ...stop, userMessageId: accepted.messageId };
      } catch (error) {
        // An unconfirmed insertion must not attach observed messages to local input.
        const buffered = active.pendingInsertion ?? [];
        active.pendingInsertion = undefined;
        active.pendingInsertionBytes = 0;
        await updates
          .enqueue(async () => {
            if (!inserted) await active.callbacks.onUpdate({ type: 'user_message_unconfirmed' });
            for (const event of buffered) await active.callbacks.onUpdate(event);
          })
          .catch(() => undefined);
        const waiter = active.waiters.shift();
        waiter?.reject(error);
        await updates.drain().catch(() => undefined);
        const failure = withProcessDiagnostics(error, child);
        if (!inserted && !connection.signal.aborted && error instanceof RequestError)
          throw withProcessDiagnostics(new AgentPromptRejectedError(error), child);
        throw normalizeAgentError(failure, inserted ? 'accepted' : 'unknown');
      }
    },
    async authenticate(methodId) {
      await withTimeout(
        connection.agent.request(methods.agent.auth.login, { methodId }),
        DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'authenticating ACP session',
      );
    },
    async cancel() {
      if (this.id) {
        await connection.agent.notify(methods.agent.session.cancel, { sessionId: this.id });
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      processEvents.dispose();
      requests.cancel();
      rejectTurns(new AgentError('transport_lost', 'ACP session closed before the turn completed'));
      if (this.id && capabilities().sessions) {
        try {
          await withTimeout(
            connection.agent.request(methods.agent.session.close, { sessionId: this.id }),
            ACP_SESSION_CLOSE_TIMEOUT_MS,
            'closing ACP session',
          );
        } catch {
          // Process shutdown remains authoritative.
        }
        dropSession(this.id);
      }
      connection.close();
      transport.kill();
    },
    async updateModel(modelId) {
      const configId =
        findAgentConfigOption(this.configOptions, 'model')?.id ?? options.resolvedModelConfigId;
      if (!this.id || !configId) return;
      const result = await withTimeout(
        connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: this.id,
          configId,
          type: 'id',
          value: modelId,
        }),
        getAgentRequestTimeoutMs(),
        'setting ACP model',
      );
      return (this.configOptions = withCustomModels(
        productConfigOptions(result.configOptions),
        options.customModels ?? [],
      ));
    },
    async updateConfigOption(configId, value) {
      if (!this.id) return [];
      const result = await withTimeout(
        connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: this.id,
          configId,
          ...(typeof value === 'boolean'
            ? { type: 'boolean' as const, value }
            : { type: 'id' as const, value }),
        }),
        getAgentRequestTimeoutMs(),
        'setting ACP configuration',
      );
      return (this.configOptions = withCustomModels(
        productConfigOptions(result.configOptions),
        options.customModels ?? [],
      ));
    },
    async setMode(modeId) {
      const mode = findAgentConfigOption(this.configOptions, 'mode');
      if (!mode) throw new AgentError('unsupported', 'Agent did not advertise a mode option');
      await this.updateConfigOption?.(mode.id, modeId);
    },
    async deleteSession(sessionId) {
      if (capabilities().delete) {
        await withTimeout(
          connection.agent.request(methods.agent.session.delete, { sessionId }),
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'deleting ACP session',
        );
      }
    },
    async listSessions(params) {
      if (!capabilities().sessions) return { sessions: [] };
      const result = await withTimeout(
        connection.agent.request(methods.agent.session.list, params ?? {}),
        ACP_SESSION_OPERATION_TIMEOUT_MS,
        'listing ACP sessions',
      );
      return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
    },
    async logout() {
      await withTimeout(
        connection.agent.request(methods.agent.auth.logout, {}),
        ACP_SESSION_OPERATION_TIMEOUT_MS,
        'logging out of ACP session',
      );
    },
  };
}
