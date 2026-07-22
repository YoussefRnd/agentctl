import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderData } from '../provider.js';
import type { BinaryInstaller } from './binary-installer.js';
import type { ProviderStore } from './provider-store.js';
import type { AgentRuntime, AgentProbeResult } from '../../acp/types.js';

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
  ) {}

  invalidateProbe(providerId: string): void {
    this.probeCache.delete(providerId);
  }

  async isBinaryOnPath(command: string): Promise<boolean> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const pathEnv = process.env.PATH ?? '';
    const pathDirs = pathEnv.split(path.delimiter);
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, command);
      try {
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (os.platform() === 'win32' || (stats.mode & 0o111) !== 0) {
            return true;
          }
        }
      } catch {
        // ignore
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
            `${agent.distribution.npx.package}@0.0.0 - ${agent.version}`,
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
    }

    const commandStr = provider.command;
    let command = commandStr;
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

    const promise = (async () => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      const launch = this.resolveLaunch(row, agent);
      let result: AgentProbeResult;
      try {
        result = await runtime.probe(launch.command, launch.args, launch.env);
      } catch (err: unknown) {
        this.store.setAuthState(providerId, 'error');
        throw err;
      }

      this.store.update(providerId, {
        configOptions: JSON.stringify(result.configOptions),
        authMethods: JSON.stringify(result.authMethods),
        supportsDynamicModel: result.supportsDynamicModel,
        supportsDynamicConfig: result.supportsDynamicConfig,
        supportsLogout: result.supportsLogout ?? false,
        modes: JSON.stringify(result.modes ?? []),
        authState: result.status === 'needs_auth' ? 'needs_auth' : 'authenticated',
      });

      return result;
    })();

    this.probeCache.set(providerId, promise);
    return promise;
  }
}
