import os from 'node:os';
import type { RegistryAgent, ACPConfigOption } from '@agentctl/shared';
import type { ProviderData } from '../provider.js';
import type { BinaryInstaller } from './binary-installer.js';
import type { ProviderStore } from './provider-store.js';
import type { PersistentAgentConnectionManager } from './persistent-connection.js';
import type { AgentRuntime, AgentProbeResult } from '../../acp/types.js';
import { isAuthRequiredError, extractConfigOptionsFromSessionResult } from '../../acp/runtime.js';
export function resolveNpxPackageSpec(pkg: string, version?: string): string {
  if (!pkg) return '';
  const lastAtIndex = pkg.lastIndexOf('@');
  if (lastAtIndex > 0) {
    return pkg;
  }
  if (!version) {
    return pkg;
  }
  return `${pkg}@${version}`;
}

export interface LaunchResolved {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function pickProxyEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const proxyEnv: Record<string, string> = {};
  const PROXY_ENV_VARS = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
  ] as const;
  for (const key of PROXY_ENV_VARS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      proxyEnv[key] = value;
    }
  }
  return proxyEnv;
}

export class ProviderLauncher {
  private probeCache = new Map<string, Promise<AgentProbeResult>>();

  constructor(
    private store: ProviderStore,
    private installer: BinaryInstaller,
    private connectionManager?: PersistentAgentConnectionManager,
  ) {}

  setConnectionManager(cm: PersistentAgentConnectionManager): void {
    this.connectionManager = cm;
  }

  invalidateProbe(providerId: string): void {
    this.probeCache.delete(providerId);
  }

  async isBinaryOnPath(command: string): Promise<boolean> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const osModule = await import('node:os');
    const pathEnv = process.env.PATH ?? '';
    const pathDirs = pathEnv.split(path.delimiter);
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, command);
      try {
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (osModule.platform() === 'win32' || (stats.mode & 0o111) !== 0) {
            return true;
          }
        }
      } catch {
        // Ignore check errors for invalid paths
      }
    }
    return false;
  }

  resolveLaunch(provider: ProviderData, agent?: RegistryAgent): LaunchResolved {
    const rawLaunchEnv = JSON.parse(provider.launchEnv || '{}') as Record<string, string>;
    const rawCustomEnv = JSON.parse(provider.customEnv || '{}') as Record<string, string>;

    const proxy = pickProxyEnv(process.env);

    if (provider.installState === 'system_available') {
      if (!agent) {
        throw new Error('Registry agent metadata required for system_available providers');
      }
      if (agent.distribution.npx) {
        return {
          command: 'npx',
          args: [
            '-y',
            resolveNpxPackageSpec(agent.distribution.npx.package, agent.version),
            ...(agent.distribution.npx.args ?? []),
          ],
          env: {
            ...proxy,
            ...agent.distribution.npx.env,
            ...rawLaunchEnv,
            ...rawCustomEnv,
          },
        };
      }
      if (agent.distribution.uvx) {
        return {
          command: 'uvx',
          args: [agent.distribution.uvx.package, ...(agent.distribution.uvx.args ?? [])],
          env: {
            ...proxy,
            ...agent.distribution.uvx.env,
            ...rawLaunchEnv,
            ...rawCustomEnv,
          },
        };
      }
      return {
        command: agent.id,
        args: [],
        env: {
          ...proxy,
          ...rawLaunchEnv,
          ...rawCustomEnv,
        },
      };
    }

    let command = provider.command;
    const args = JSON.parse(provider.launchArgs || '[]') as string[];

    const binEntry = agent?.distribution.binary?.[process.platform];
    if (provider.installState === 'installed_local' && agent && binEntry?.archive) {
      const versionedDir = this.installer.getVersionedInstallDir(
        agent.id,
        agent.version,
        binEntry.archive,
      );
      command = `${versionedDir}/${binEntry.cmd || agent.id}`;
    }

    const env = {
      ...proxy,
      ...rawLaunchEnv,
      ...rawCustomEnv,
    };

    return { command, args, env };
  }

  probe(
    providerId: string,
    runtime: AgentRuntime,
    agent: RegistryAgent,
  ): Promise<AgentProbeResult> {
    const cached = this.probeCache.get(providerId);
    if (cached) return cached;

    const promise = (async (): Promise<AgentProbeResult> => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      if (this.connectionManager && row.authState === 'authenticated') {
        try {
          const persistent = await this.connectionManager.getConnection(providerId);
          const conn = persistent.connection as unknown as {
            newSession?: (p: unknown) => Promise<unknown>;
          };
          if (typeof conn.newSession === 'function') {
            const sessionResult = (await conn.newSession({
              cwd: os.tmpdir(),
              mcpServers: [],
            })) as Parameters<typeof extractConfigOptionsFromSessionResult>[0];
            const configOptions = extractConfigOptionsFromSessionResult(sessionResult);
            const probeResult: AgentProbeResult = {
              status: 'ready',
              configOptions,
              authMethods: row.authMethods
                ? (JSON.parse(row.authMethods) as AgentProbeResult['authMethods'])
                : [],
              supportsDynamicModel: configOptions.some(
                (opt) => opt.id === 'model' || opt.id === 'selectedModel',
              ),
              supportsDynamicConfig: configOptions.length > 0,
              supportsLogout: row.supportsLogout,
              modes: row.modes ? (JSON.parse(row.modes) as string[]) : [],
            };
            this.store.update(providerId, {
              configOptions: JSON.stringify(configOptions),
              supportsDynamicModel: probeResult.supportsDynamicModel,
              supportsDynamicConfig: probeResult.supportsDynamicConfig,
              authState: 'authenticated',
            });
            return probeResult;
          }
        } catch {
          // If persistent connection probe fails, fall back to runtime.probe
        }
      }

      const launch = this.resolveLaunch(row, agent);
      let result: AgentProbeResult;
      try {
        result = await runtime.probe(launch.command, launch.args, launch.env);
      } catch (err: unknown) {
        if (isAuthRequiredError(err)) {
          if (row.authState !== 'authenticated') {
            this.store.setAuthState(providerId, 'needs_auth');
          }
          const existingConfigOpts = row.configOptions
            ? (JSON.parse(row.configOptions) as ACPConfigOption[])
            : [];
          const fallbackResult: AgentProbeResult = {
            status: row.authState === 'authenticated' ? 'ready' : 'needs_auth',
            configOptions: existingConfigOpts,
            authMethods: row.authMethods
              ? (JSON.parse(row.authMethods) as AgentProbeResult['authMethods'])
              : [],
            supportsDynamicModel: row.supportsDynamicModel,
            supportsDynamicConfig: row.supportsDynamicConfig,
            supportsLogout: row.supportsLogout,
          };
          return fallbackResult;
        }
        if (row.authState !== 'authenticated') {
          this.store.setAuthState(providerId, 'error');
        }
        throw err;
      }

      const nextAuthState =
        result.status === 'needs_auth' && row.authState !== 'authenticated'
          ? 'needs_auth'
          : row.authState === 'authenticated'
            ? 'authenticated'
            : result.status === 'needs_auth'
              ? 'needs_auth'
              : 'authenticated';

      this.store.update(providerId, {
        configOptions: JSON.stringify(result.configOptions),
        authMethods: JSON.stringify(result.authMethods),
        supportsDynamicModel: result.supportsDynamicModel,
        supportsDynamicConfig: result.supportsDynamicConfig,
        supportsLogout: result.supportsLogout ?? false,
        modes: JSON.stringify(result.modes ?? []),
        authState: nextAuthState,
      });

      return result;
    })();

    this.probeCache.set(providerId, promise);
    return promise;
  }
}
