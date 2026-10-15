import {
  PROTOCOL_VERSION,
  type ClientCapabilities,
  type ClientSideConnection,
  type InitializeResponse,
} from '@agentclientprotocol/sdk';
import { applicationInfo } from '../../config/application-info.js';
import type { AcpParsedCapabilities, InitializeAcpConnectionOptions } from '../types.js';
import { withTimeout } from '../transport/acp-process-lifecycle.js';
export { withTimeout };

export const AGENTCTL_CLIENT_CAPABILITIES: ClientCapabilities = {
  terminal: true,
  subagents: {},
  ...(process.platform === 'win32' ? {} : { auth: { terminal: true } }),
  fs: { readTextFile: true, writeTextFile: true },
  session: { configOptions: { boolean: {} }, compaction: {}, notices: {} },
  elicitation: { form: {}, url: {} },
  _meta: {
    'agentctl.dev': {
      extensionMethods: ['_agentctl.dev/builtin/bash', '_agentctl.dev/terminal/write'],
      extensionMethodPrefixes: ['_agentctl.dev/mcp/'],
    },
  },
};

export function sessionSupportsDelete(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') {
    return false;
  }
  return Boolean((caps as { delete?: unknown }).delete);
}

export function sessionSupportsClose(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { close?: unknown }).close);
}

export function sessionSupportsResume(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { resume?: unknown }).resume);
}

export function parseAcpCapabilities(agentCapabilities: unknown): AcpParsedCapabilities {
  const agentCapsObj = agentCapabilities as
    | {
        sessionCapabilities?: Record<string, unknown>;
        loadSession?: boolean;
        promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
        mcpCapabilities?: { http?: boolean; sse?: boolean; acp?: boolean };
      }
    | undefined;
  const caps = agentCapsObj?.sessionCapabilities;
  const supportsResume = Boolean(caps?.resume);
  return {
    ...(agentCapsObj?.mcpCapabilities
      ? {
          supportsMcpHttp: agentCapsObj.mcpCapabilities.http === true,
          supportsMcpSse: agentCapsObj.mcpCapabilities.sse === true,
          supportsMcpAcp: agentCapsObj.mcpCapabilities.acp === true,
        }
      : {}),
    supportsForkSession: Boolean(caps?.fork),
    supportsResumeSession: supportsResume,
    supportsCloseSession: !!caps?.close,
    supportsDeleteSession: sessionSupportsDelete(caps),
    supportsListSessions: !!caps?.list,
    supportsAdditionalDirectories: !!caps?.additionalDirectories,
    supportsLoadSession: Boolean(agentCapsObj?.loadSession),
    supportsImage: Boolean(agentCapsObj?.promptCapabilities?.image),
    supportsAudio: Boolean(agentCapsObj?.promptCapabilities?.audio),
    supportsEmbeddedContext: Boolean(agentCapsObj?.promptCapabilities?.embeddedContext),
  };
}

export async function initializeAcpConnection(
  connection: Pick<ClientSideConnection, 'initialize'>,
  options: InitializeAcpConnectionOptions = {},
) {
  const clientInfo = options.clientInfo ?? applicationInfo();
  const clientCapabilities: ClientCapabilities = options.clientCapabilities ?? {};

  const initPromise = connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: clientCapabilities,
    clientInfo,
  });

  const promises: Promise<unknown>[] = [initPromise];
  if (options.transport) {
    promises.push(
      options.transport.closed.then(() => {
        throw new Error('ACP agent process exited before initialization completed');
      }),
    );
  }

  const racePromise = Promise.race(promises);
  const rawResult = options.timeoutMs
    ? await withTimeout(racePromise, options.timeoutMs, 'initializing ACP connection')
    : await racePromise;

  const initResult = rawResult as InitializeResponse;
  if (initResult.protocolVersion !== PROTOCOL_VERSION) {
    options.transport?.kill();
    throw new Error(
      `Unsupported ACP protocol version ${String(initResult.protocolVersion)}; expected ${String(PROTOCOL_VERSION)}`,
    );
  }
  const parsedCapabilities = parseAcpCapabilities(initResult.agentCapabilities);

  return { initResult, parsedCapabilities };
}
