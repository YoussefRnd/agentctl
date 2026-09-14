import type { spawn } from 'node:child_process';
import type { AgentDriver, AgentSessionCallbacks, AgentSessionOptions } from '../agent/types.js';
import type { Logger } from '../logger.js';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';
import type { IConnectionManager } from './types.js';
import { AcpV1AgentDriver } from './runtime.js';
import { AcpV2AgentDriver } from './v2/runtime.js';

export type AcpProtocolVersion = 'v1' | 'v2';

export function selectAcpProtocol(env?: Record<string, string>): AcpProtocolVersion {
  const configured = env?.AGENTCTL_ACP_PROTOCOL ?? process.env.AGENTCTL_ACP_PROTOCOL;
  return configured?.toLowerCase() === 'v2' || configured === '2' ? 'v2' : 'v1';
}

/** Selects a protocol adapter while keeping the product-facing driver stable. */
export class AcpAgentDriver implements AgentDriver {
  constructor(
    private readonly v1: AcpV1AgentDriver = new AcpV1AgentDriver(),
    private readonly v2: AcpV2AgentDriver = new AcpV2AgentDriver(),
    private readonly diagnostics?: AgentDiagnosticsRecorder,
  ) {}

  static create(
    spawnImpl: typeof spawn,
    logger: Logger,
    diagnostics?: AgentDiagnosticsRecorder,
  ): AcpAgentDriver {
    return new AcpAgentDriver(
      new AcpV1AgentDriver(spawnImpl, logger, undefined, undefined, diagnostics),
      new AcpV2AgentDriver(spawnImpl, logger, undefined, diagnostics),
      diagnostics,
    );
  }

  setConnectionManager(manager: IConnectionManager): void {
    this.v1.setConnectionManager(manager);
  }

  startSession(
    command: string,
    args: string[],
    options: AgentSessionOptions,
    callbacks: AgentSessionCallbacks,
  ) {
    const version = selectAcpProtocol(options.env);
    this.diagnostics?.record({
      kind: 'adapter_selected',
      adapter: version === 'v2' ? 'acp-v2' : 'acp-v1',
      providerId: options.providerId,
      intent: options.intent.kind,
      features: options.features,
    });
    return (version === 'v2' ? this.v2 : this.v1).startSession(command, args, options, callbacks);
  }

  inspectProvider(command: string, args: string[], env?: Record<string, string>) {
    return this.forEnv(env).inspectProvider(command, args, env);
  }

  deleteSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    agentSessionId: string,
  ): Promise<void> {
    const driver = this.forEnv(env);
    return driver.deleteSession
      ? driver.deleteSession(command, args, env, agentSessionId)
      : Promise.resolve();
  }

  invalidateProviderCache(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    const driver: AgentDriver = this.forEnv(env);
    return driver.invalidateProviderCache
      ? driver.invalidateProviderCache(command, args, env)
      : Promise.resolve();
  }

  authenticateProvider(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const driver = this.forEnv(env);
    if (!driver.authenticateProvider) {
      return Promise.reject(new Error('Agent adapter does not support authentication'));
    }
    return driver.authenticateProvider(command, args, env, methodId, params);
  }

  logoutProvider(command: string, args: string[], env?: Record<string, string>): Promise<void> {
    const driver = this.forEnv(env);
    if (!driver.logoutProvider) return Promise.resolve();
    return driver.logoutProvider(command, args, env);
  }

  private forEnv(env?: Record<string, string>): AgentDriver {
    return selectAcpProtocol(env) === 'v2' ? this.v2 : this.v1;
  }
}
