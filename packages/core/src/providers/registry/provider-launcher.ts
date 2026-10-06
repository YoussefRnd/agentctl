import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderData } from '../provider.js';
import type { BinaryInstaller } from './binary-installer.js';
import type { ProviderStore } from './provider-store.js';
import type { AgentDescriptor, AgentDriver } from '../../agent/types.js';
import { isAgentAuthenticationRequiredError } from '../../agent/errors.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import { defaultCredentialVault } from '../../security/credential-vault.js';
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

export function resolveUvxPackageSpec(pkg: string, version?: string): string {
  if (!pkg || !version || /(?:==|~=|>=|<=|!=|\s@\s|https?:\/\/)/.test(pkg)) return pkg;
  const extrasIndex = pkg.indexOf('[');
  if (extrasIndex > 0) {
    return `${pkg.slice(0, extrasIndex)}${pkg.slice(extrasIndex)}==${version}`;
  }
  return `${pkg}==${version}`;
}

export interface LaunchResolved {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function probeResultUpdate(result: AgentDescriptor, row: ProviderData) {
  const authState: 'required' | 'authenticated' | 'not_required' =
    result.status === 'needs_auth'
      ? 'required'
      : result.authMethods.length > 0
        ? 'authenticated'
        : 'not_required';

  return {
    configOptions: JSON.stringify(result.configOptions),
    authMethods: JSON.stringify(result.authMethods),
    supportsDynamicModel: result.supportsDynamicModel,
    supportsDynamicConfig: result.supportsDynamicConfig,
    supportsLogout: result.supportsLogout ?? false,
    features: JSON.stringify(result.features ?? jsonCodecs.agentFeatures(row.features)),
    capabilitySnapshot: result.snapshot ? JSON.stringify(result.snapshot) : null,
    modes: JSON.stringify(result.modes ?? []),
    authState,
    connectionState: 'ready' as const,
    authError: null,
    lastVerifiedAt: new Date(),
  };
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
  private probeCache = new Map<
    string,
    { promise: Promise<AgentDescriptor>; expiresAt: number; fingerprint: string }
  >();
  private readonly probeTtlMs = 30_000;

  constructor(
    private store: ProviderStore,
    private installer: BinaryInstaller,
  ) {}

  invalidateProbe(providerId: string, runtime?: AgentDriver, agent?: RegistryAgent): void {
    this.probeCache.delete(providerId);
    if (runtime?.invalidateProviderCache) {
      const row = this.store.get(providerId);
      if (row) {
        try {
          const launch = this.resolveLaunch(row, agent);
          void runtime.invalidateProviderCache(launch.command, launch.args, launch.env, {
            providerVersion: row.installedVersion ?? agent?.version ?? row.version ?? undefined,
          });
        } catch {
          // ignore launch resolution errors during invalidation
        }
      }
    }
  }

  async isBinaryOnPath(command: string): Promise<boolean> {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const osModule = await import('node:os');
    const pathEnv = process.env.PATH ?? '';
    const pathDirs = pathEnv.split(path.delimiter);
    const extensions =
      osModule.platform() === 'win32'
        ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')]
        : [''];
    for (const dir of pathDirs) {
      for (const extension of extensions) {
        const fullPath = path.join(dir, `${command}${extension}`);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && (osModule.platform() === 'win32' || (stats.mode & 0o111) !== 0)) {
            return true;
          }
        } catch {
          // Try the next PATH entry/extension.
        }
      }
    }
    return false;
  }

  async detectSystemBinary(
    agent: RegistryAgent,
    platform: string,
  ): Promise<{ command: string; args?: string[] } | null> {
    const binary = agent.distribution.binary;
    const target = binary ? binary[platform] : undefined;
    if (target?.cmd) {
      const baseCmd = target.cmd.replace(/^\.\//, '').replace(/\.exe$/, '');
      if (baseCmd && baseCmd !== 'npx' && baseCmd !== 'uvx') {
        if (await this.isBinaryOnPath(baseCmd)) {
          return { command: baseCmd, args: target.args ?? [] };
        }
      }
    }

    return null;
  }

  resolveLaunch(provider: ProviderData, agent?: RegistryAgent): LaunchResolved {
    const base = this.resolveBaseLaunch(provider, agent);
    return this.resolveLaunchFromBase(provider, base);
  }

  resolveLaunchFromBase(provider: ProviderData, base: LaunchResolved): LaunchResolved {
    const rawCustomEnv = jsonCodecs.stringRecord(provider.customEnv);
    const resolvedCustomEnv = defaultCredentialVault.resolveEnvSync(rawCustomEnv);
    const proxy = pickProxyEnv(process.env);

    return {
      ...base,
      env: {
        ...proxy,
        ...base.env,
        ...resolvedCustomEnv,
        ...(provider.protocol && provider.protocol !== 'auto'
          ? { AGENTCTL_ACP_PROTOCOL: provider.protocol }
          : {}),
      },
    };
  }

  async inspectLaunch(
    providerId: string,
    runtime: AgentDriver,
    launch: LaunchResolved,
    providerVersion?: string,
  ): Promise<AgentDescriptor> {
    const row = this.store.get(providerId);
    if (!row) throw new Error(`Provider ${providerId} not found`);

    try {
      return await runtime.inspectProvider(launch.command, launch.args, launch.env, {
        providerVersion,
      });
    } catch (err: unknown) {
      if (!isAgentAuthenticationRequiredError(err)) throw err;
      return {
        status: 'needs_auth',
        configOptions: jsonCodecs.agentConfigOptions(row.configOptions),
        authMethods: jsonCodecs.authMethods(row.authMethods),
        supportsDynamicModel: row.supportsDynamicModel,
        supportsDynamicConfig: row.supportsDynamicConfig,
        supportsLogout: row.supportsLogout,
        features: jsonCodecs.agentFeatures(row.features),
        snapshot: jsonCodecs.capabilitySnapshot(row.capabilitySnapshot),
      };
    }
  }

  /** Resolve persisted launch metadata without decrypting user credentials. */
  resolveBaseLaunch(provider: ProviderData, agent?: RegistryAgent): LaunchResolved {
    const rawLaunchEnv = jsonCodecs.stringRecord(provider.launchEnv);
    const command = provider.command;
    const args = jsonCodecs.stringArray(provider.launchArgs);

    // Installed launch metadata is authoritative. Registry metadata is only a
    // fallback for legacy rows that predate persisted package-runner args.
    if (args.length > 0 || (command !== 'npx' && command !== 'uvx')) {
      return { command, args, env: rawLaunchEnv };
    }

    if (command === 'npx' && args.length === 0 && agent?.distribution.npx) {
      args.push(
        '-y',
        resolveNpxPackageSpec(
          agent.distribution.npx.package,
          provider.installedVersion ?? agent.version,
        ),
        ...(agent.distribution.npx.args ?? []),
      );
    } else if (command === 'uvx' && args.length === 0 && agent?.distribution.uvx) {
      args.push(
        resolveUvxPackageSpec(
          agent.distribution.uvx.package,
          provider.installedVersion ?? agent.version,
        ),
        ...(agent.distribution.uvx.args ?? []),
      );
    }

    return {
      command,
      args,
      env: {
        ...(command === 'npx' ? agent?.distribution.npx?.env : agent?.distribution.uvx?.env),
        ...rawLaunchEnv,
      },
    };
  }

  probe(providerId: string, runtime: AgentDriver, agent: RegistryAgent): Promise<AgentDescriptor> {
    const rowForFingerprint = this.store.get(providerId);
    const fingerprint = rowForFingerprint
      ? JSON.stringify([
          rowForFingerprint.command,
          rowForFingerprint.launchArgs,
          rowForFingerprint.launchEnv,
          rowForFingerprint.customEnv,
          rowForFingerprint.installedVersion,
          rowForFingerprint.installedVersion ?? agent.version,
        ])
      : providerId;
    const cached = this.probeCache.get(providerId);
    if (cached && cached.expiresAt > Date.now() && cached.fingerprint === fingerprint) {
      return cached.promise;
    }
    if (cached) this.probeCache.delete(providerId);

    const promise = (async (): Promise<AgentDescriptor> => {
      const row = this.store.get(providerId);
      if (!row) throw new Error(`Provider ${providerId} not found`);

      this.store.setAuthDetails(providerId, { connectionState: 'checking' });

      let launch: LaunchResolved;
      try {
        launch = this.resolveLaunch(row, agent);
      } catch (error) {
        this.store.setAuthDetails(providerId, {
          connectionState: 'error',
        });
        throw error;
      }
      try {
        const result = await this.inspectLaunch(
          providerId,
          runtime,
          launch,
          row.installedVersion ?? agent.version,
        );
        this.store.update(providerId, probeResultUpdate(result, row));
        return result;
      } catch (err: unknown) {
        this.store.setAuthDetails(providerId, {
          connectionState: 'error',
        });
        throw err;
      }
    })();

    this.probeCache.set(providerId, {
      promise,
      expiresAt: Date.now() + this.probeTtlMs,
      fingerprint,
    });
    void promise.catch(() => {
      if (this.probeCache.get(providerId)?.promise === promise) {
        this.probeCache.delete(providerId);
      }
    });
    return promise;
  }
}
