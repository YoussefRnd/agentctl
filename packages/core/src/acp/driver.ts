import type { spawn } from 'node:child_process';
import type { AgentDiagnosticsRecorder } from '../agent/diagnostics.js';
import type {
  AgentAuthenticationOptions,
  AgentDriver,
  AgentInspectionOptions,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../agent/types.js';
import type { Logger } from '../logger.js';
import { getCacheKey } from './cache/launch-identity.js';
import { AcpProtocolIncompatibilityError } from './protocol/negotiation.js';
import { cleanEnv } from './transport/acp-process-lifecycle.js';
import type { IConnectionManager } from './transport/connection-lease.js';
import { AcpV1AgentDriver } from './v1/driver.js';
import { AcpV2AgentDriver } from './v2/driver.js';

export type AcpProtocolVersion = 'v1' | 'v2' | 'auto';

export function selectAcpProtocol(env?: Record<string, string>): AcpProtocolVersion {
  const configured = env?.AGENTCTL_ACP_PROTOCOL ?? process.env.AGENTCTL_ACP_PROTOCOL;
  if (configured?.toLowerCase() === 'v2' || configured === '2') return 'v2';
  if (configured?.toLowerCase() === 'v1' || configured === '1') return 'v1';
  return 'auto';
}

/** Selects a protocol adapter while keeping the product-facing driver stable. */
export class AcpAgentDriver implements AgentDriver {
  private protocols = new Map<string, { version: 'v1' | 'v2'; expiresAt: number }>();

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
    return this.run(command, args, options.env, async (driver, version) => {
      this.diagnostics?.record({
        kind: 'adapter_selected',
        adapter: version === 'v2' ? 'acp-v2' : 'acp-v1',
        providerId: options.providerId,
        intent: options.intent.kind,
        features: options.features,
      });
      return driver.startSession(command, args, options, callbacks);
    });
  }

  inspectProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ) {
    return this.run(command, args, env, (driver) =>
      driver.inspectProvider(command, args, env, options),
    );
  }

  listSessions(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    params: { cwd?: string; cursor?: string },
  ) {
    return this.run(command, args, env, (driver) => {
      if (!driver.listSessions) throw new Error('Agent does not support native session listing');
      return driver.listSessions(command, args, env, params);
    });
  }

  deleteSession(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    agentSessionId: string,
  ): Promise<void> {
    return this.run(
      command,
      args,
      env,
      (driver) => driver.deleteSession?.(command, args, env, agentSessionId) ?? Promise.resolve(),
    );
  }

  invalidateProviderCache(
    command: string,
    args: string[],
    env?: Record<string, string>,
    options?: AgentInspectionOptions,
  ): Promise<void> {
    this.protocols.delete(this.key(command, args, env));
    return Promise.all([
      this.v1.invalidateProviderCache?.(command, args, env, options),
      (this.v2 as AgentDriver).invalidateProviderCache?.(command, args, env, options),
    ]).then(() => undefined);
  }

  async authenticateProvider(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    methodId: string,
    options?: AgentAuthenticationOptions,
  ): Promise<void> {
    await this.run(command, args, env, (driver) => {
      if (!driver.authenticateProvider)
        throw new Error('Agent adapter does not support authentication');
      return driver.authenticateProvider(command, args, env, methodId, options);
    });
    await this.invalidateProviderCache(command, args, env);
  }

  async logoutProvider(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    await this.run(
      command,
      args,
      env,
      (driver) => driver.logoutProvider?.(command, args, env) ?? Promise.resolve(),
    );
    await this.invalidateProviderCache(command, args, env);
  }

  private key(command: string, args: string[], env?: Record<string, string>): string {
    return getCacheKey(command, args, cleanEnv(env));
  }

  private cacheProtocol(key: string, version: 'v1' | 'v2') {
    if (this.protocols.size >= 256) this.protocols.delete(this.protocols.keys().next().value!);
    this.protocols.set(key, { version, expiresAt: Date.now() + 60 * 60 * 1000 });
  }

  private async run<T>(
    command: string,
    args: string[],
    env: Record<string, string> | undefined,
    operation: (driver: AgentDriver, version: 'v1' | 'v2') => Promise<T>,
  ): Promise<T> {
    const configured = selectAcpProtocol(env);
    const key = this.key(command, args, env);
    const cached = this.protocols.get(key);
    if (cached && cached.expiresAt <= Date.now()) this.protocols.delete(key);
    const v2Enabled = /^(1|true)$/i.test(
      env?.AGENTCTL_ACP_V2_ENABLED ?? process.env.AGENTCTL_ACP_V2_ENABLED ?? '',
    );
    const version =
      configured === 'auto'
        ? v2Enabled
          ? (this.protocols.get(key)?.version ?? 'v2')
          : 'v1'
        : configured;
    try {
      const result = await operation(version === 'v2' ? this.v2 : this.v1, version);
      if (configured === 'auto' && v2Enabled) this.cacheProtocol(key, version);
      return result;
    } catch (error) {
      if (
        configured !== 'auto' ||
        version !== 'v2' ||
        !(error instanceof AcpProtocolIncompatibilityError)
      )
        throw error;
      const result = await operation(this.v1, 'v1');
      this.cacheProtocol(key, 'v1');
      return result;
    }
  }
}
