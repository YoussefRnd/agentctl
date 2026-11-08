import { observeProviderPrompt, captureTraceparent } from '../../observability/index.js';
import { RequestError } from '@agentclientprotocol/sdk';
import { findAgentConfigOption, withCustomModels, type AgentConfigOption } from '@agentctl/shared';
import type { ChildProcess } from 'node:child_process';
import { normalizeAgentError } from '../../agent/errors.js';
import type { AgentPromptResult, AgentSession, AgentSessionOptions } from '../../agent/types.js';
import {
  DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
  getAgentRequestTimeoutMs,
} from '../../config/runtime-defaults.js';
import { buildPromptBlocks, checkPromptDispatch } from '../protocol/prompt.js';
import type { TerminalManager } from '../protocol/terminal-manager.js';
import { normalizeAcpUsage } from '../protocol/usage.js';
import { bindSessionProcessEvents, withTimeout } from '../transport/acp-process-lifecycle.js';
import type { AcpAgentConnection } from '../transport/client-connection.js';
import type { AcpConnectionLease } from '../transport/connection-lease.js';
import {
  ACP_SESSION_CLOSE_TIMEOUT_MS,
  ACP_SESSION_OPERATION_TIMEOUT_MS,
} from '../transport/limits.js';
import type { cancellableCallbacks } from '../transport/session-requests.js';
import { withProcessDiagnostics } from '../transport/stderr.js';
import type { drainableCallbacks } from '../transport/update-drain.js';
import type { AcpParsedCapabilities } from '../types.js';
import type { AgentStreamTransport } from '../transport/acp-process-lifecycle.js';
import type { IConnectionManager } from '../transport/connection-lease.js';
import { extractConfigOptionsFromSessionResult } from './configuration.js';

interface SessionContext {
  options: AgentSessionOptions;
  child: ChildProcess;
  connection: AcpAgentConnection;
  transport: AgentStreamTransport;
  capabilities: () => AcpParsedCapabilities;
  legacyModelSelection: () => boolean;
  processEvents: ReturnType<typeof bindSessionProcessEvents>;
  requests: ReturnType<typeof cancellableCallbacks>;
  updates: ReturnType<typeof drainableCallbacks>;
  terminalManager?: TerminalManager;
  isPersistent: boolean;
  providerId: string;
  manager?: IConnectionManager;
  lease?: AcpConnectionLease;
}

/** V1 prompt responses span the turn; completion also waits for persisted updates. */
export function createV1Session(context: SessionContext): AgentSession {
  const {
    options,
    child,
    connection,
    transport,
    capabilities,
    legacyModelSelection,
    processEvents,
    requests,
    updates,
    terminalManager,
    isPersistent,
    providerId,
    manager,
    lease,
  } = context;
  return {
    id: null,
    history: 'fresh',
    closed: Promise.race([connection.closed, transport.closed]),
    onError: processEvents.onError,
    onClose: processEvents.onClose,
    async prompt(
      text: string,
      attachments?: { filePath: string; mimeType: string }[],
      embeddedContext?: string,
    ): Promise<AgentPromptResult> {
      return observeProviderPrompt('acp-v1', async () => {
        const traceparent = captureTraceparent();
        const signal = requests.signal;
        const promptParts = await buildPromptBlocks({
          text,
          attachments,
          embeddedContext,
          supportsImage: capabilities().supportsImage,
          supportsAudio: capabilities().supportsAudio,
          supportsEmbeddedContext: capabilities().supportsEmbeddedContext,
        });
        checkPromptDispatch(signal);

        const response = await connection
          .prompt({
            sessionId: this.id ?? '',
            prompt: promptParts,
            ...(traceparent ? { _meta: { traceparent } } : {}),
          })
          .catch(async (error: unknown) => {
            await connection.drainSessionUpdates?.(this.id ?? '').catch(() => undefined);
            await updates.drain().catch(() => undefined);
            const failure = withProcessDiagnostics(error, child);
            // v1's response spans the whole turn. Only its explicit auth code proves rejection;
            // output observed before this response will still override rejection downstream.
            throw normalizeAgentError(
              failure,
              error instanceof RequestError && error.code === -32000 ? 'rejected' : 'unknown',
            );
          });
        try {
          await connection.drainSessionUpdates?.(this.id ?? '');
        } catch (error) {
          await updates.drain().catch(() => undefined);
          throw error;
        }
        await updates.drain();
        return {
          stopReason: response.stopReason,
          usage: normalizeAcpUsage(response.usage),
        };
      });
    },
    async authenticate(methodId: string): Promise<void> {
      await withTimeout(
        connection.authenticate({ methodId }),
        DEFAULT_PROVIDER_AUTH_TIMEOUT_MS,
        'authenticating ACP session',
      );
    },
    async cancel(): Promise<void> {
      if (this.id) {
        await (connection.cancel({ sessionId: this.id }) as Promise<unknown>);
      }
    },
    async close(): Promise<void> {
      requests.cancel();
      processEvents.dispose();
      if (this.id) {
        if (isPersistent && manager) {
          await manager.closeSession(providerId, this.id, lease!);
        } else if (!isPersistent && capabilities().supportsCloseSession && transport.isAlive) {
          try {
            await withTimeout(
              connection.closeSession({ sessionId: this.id }),
              ACP_SESSION_CLOSE_TIMEOUT_MS,
              'closing ACP session',
            );
          } catch {
            // Ignore error on close, we still want to kill the process
          }
        }
      }
      if (!isPersistent) {
        connection.close?.();
        transport.kill();
        if (terminalManager) {
          await terminalManager.dispose();
        }
      }
    },
    async updateModel(modelId: string): Promise<AgentConfigOption[] | undefined> {
      const configId =
        findAgentConfigOption(this.configOptions, 'model')?.id ?? options.resolvedModelConfigId;
      if (!this.id || !configId) return undefined;
      if (legacyModelSelection()) {
        await withTimeout(
          connection.request('session/set_model', { sessionId: this.id, modelId }),
          getAgentRequestTimeoutMs(),
          'setting legacy ACP model',
        );
        return (this.configOptions = this.configOptions?.map((option) =>
          option.id === configId ? { ...option, currentValue: modelId } : option,
        ));
      }
      const result = await withTimeout(
        connection.setSessionConfigOption({
          sessionId: this.id,
          configId,
          value: modelId,
        }),
        getAgentRequestTimeoutMs(),
        'setting ACP model',
      );
      if (!Array.isArray(result.configOptions)) return undefined;
      return (this.configOptions = withCustomModels(
        extractConfigOptionsFromSessionResult(result),
        options.customModels ?? [],
      ));
    },
    async updateConfigOption(
      configId: string,
      value: string | boolean,
    ): Promise<AgentConfigOption[]> {
      if (!this.id) return [];
      if (typeof value === 'boolean') {
        const result = await withTimeout(
          connection.setSessionConfigOption({
            sessionId: this.id,
            configId,
            type: 'boolean',
            value,
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP configuration',
        );
        return (this.configOptions = withCustomModels(
          extractConfigOptionsFromSessionResult(result),
          options.customModels ?? [],
        ));
      }
      const result = await withTimeout(
        connection.setSessionConfigOption({
          sessionId: this.id,
          configId,
          value,
        }),
        getAgentRequestTimeoutMs(),
        'setting ACP configuration',
      );
      return (this.configOptions = withCustomModels(
        extractConfigOptionsFromSessionResult(result),
        options.customModels ?? [],
      ));
    },
    async setMode(modeId: string): Promise<void> {
      if (this.id) {
        await withTimeout(
          connection.setSessionMode({
            sessionId: this.id,
            modeId,
          }),
          getAgentRequestTimeoutMs(),
          'setting ACP mode',
        );
      }
    },
    async deleteSession(acpSessionId: string): Promise<void> {
      if (capabilities().supportsDeleteSession) {
        await withTimeout(
          connection.deleteSession({ sessionId: acpSessionId }),
          ACP_SESSION_OPERATION_TIMEOUT_MS,
          'deleting ACP session',
        );
      }
    },
    async listSessions(params?: {
      cwd?: string;
      cursor?: string;
    }): Promise<{ sessions: unknown[]; nextCursor?: string }> {
      if (!capabilities().supportsListSessions) return { sessions: [] };
      const result = await withTimeout(
        connection.listSessions(params ?? {}),
        ACP_SESSION_OPERATION_TIMEOUT_MS,
        'listing ACP sessions',
      );
      return { sessions: result.sessions, nextCursor: result.nextCursor ?? undefined };
    },
    async logout(): Promise<void> {
      await withTimeout(
        connection.logout({}),
        ACP_SESSION_OPERATION_TIMEOUT_MS,
        'logging out of ACP session',
      );
    },
    writeTerminalInput(terminalId: string, data: string): boolean {
      if (isPersistent && manager) {
        return manager.writeTerminalInput(terminalId, data, lease!, this.id ?? '');
      }
      return terminalManager ? terminalManager.write(terminalId, data) : false;
    },
  };
}
