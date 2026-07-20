import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { RegistryAgent } from '@agentctl/shared';
import type { AgentRuntime, AgentProbeResult } from '../acp-transport.js';
import type { ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { BinaryInstaller } from './binary-installer.js';

const execFilePromise = promisify(execFile);

const PROBE_CACHE_TTL_MS = 60_000;

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

function pickProxyEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const proxyEnv: Record<string, string> = {};
  for (const key of PROXY_ENV_VARS) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      proxyEnv[key] = value;
    }
  }
  return proxyEnv;
}

function findBinaryOnPath(command: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    const fullPath = path.join(dir, command);
    try {
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (os.platform() === 'win32' || (stats.mode & 0o111) !== 0) {
          return fullPath;
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

const packageToBinaryMap: Record<string, string[]> = {
  '@anthropic-ai/claude-code': ['claude', 'claude-code'],
};

interface CacheEntry {
  promise: Promise<AgentProbeResult>;
  expiresAt: number;
}

export class ProviderLauncher {
  private probeCache = new Map<string, CacheEntry>();

  constructor(
    private store: ProviderStore,
    private installer: BinaryInstaller,
  ) {}

  async isBinaryOnPath(command: string): Promise<boolean> {
    try {
      const cmd = os.platform() === 'win32' ? 'where.exe' : 'which';
      await execFilePromise(cmd, [command]);
      return true;
    } catch {
      return false;
    }
  }

  resolveLaunch(
    provider: ProviderData,
    registryAgent?: RegistryAgent,
  ): { command: string; args: string[]; env: Record<string, string> } {
    let command = provider.command;
    let args: string[] = JSON.parse(provider.launchArgs || '[]') as string[];
    let env: Record<string, string> = JSON.parse(provider.launchEnv || '{}') as Record<
      string,
      string
    >;

    const registryAgentDist = registryAgent?.distribution;
    if (registryAgentDist?.npx) {
      const { package: pkg, args: npxArgs = [], env: npxEnv } = registryAgentDist.npx;
      const candidateBinaries = packageToBinaryMap[pkg] ?? [pkg.split('/').pop() ?? ''];
      let localBinaryPath: string | null = null;
      for (const bin of candidateBinaries) {
        localBinaryPath = findBinaryOnPath(bin);
        if (localBinaryPath) break;
      }

      if (localBinaryPath) {
        command = localBinaryPath;
        args = npxArgs;
        env = npxEnv;
      } else {
        command = 'npx';
        const spec = registryAgent?.version ? `${pkg}@0.0.0 - ${registryAgent.version}` : pkg;
        args = ['-y', spec, ...npxArgs];
        env = npxEnv;
      }
    } else if (registryAgentDist?.uvx) {
      const { package: pkg, args: uvxArgs = [], env: uvxEnv } = registryAgentDist.uvx;
      const binName = pkg.split('/').pop() ?? '';
      const localBinaryPath = findBinaryOnPath(binName);
      if (localBinaryPath) {
        command = localBinaryPath;
        args = uvxArgs;
        env = uvxEnv;
      } else {
        command = 'uvx';
        args = [pkg, ...uvxArgs];
        env = uvxEnv;
      }
    } else if (provider.installState === 'system_available') {
      throw new Error('Registry agent metadata required for system_available providers');
    }

    const customEnv = JSON.parse(provider.customEnv || '{}') as Record<string, string>;
    env = { ...pickProxyEnv(process.env), ...env, ...customEnv };

    return { command, args, env };
  }

  async probe(
    providerId: string,
    runtime: AgentRuntime,
    agent: RegistryAgent,
  ): Promise<AgentProbeResult> {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const launch = this.resolveLaunch(provider, agent);
    const hash = crypto.createHash('sha256').update(JSON.stringify(launch)).digest('hex');
    const cacheKey = `${providerId}:${hash}`;

    const cached = this.probeCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.promise;
    }

    const probePromise = (async () => {
      try {
        const result = await runtime.probe(launch.command, launch.args, launch.env);
        this.store.setAuthState(
          providerId,
          result.status === 'ready' ? 'authenticated' : result.status,
        );
        this.store.setConfigOptions(providerId, result.configOptions);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAuthError =
          msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('unauthorized');
        this.store.setAuthState(providerId, isAuthError ? 'needs_auth' : 'error');
        this.probeCache.delete(cacheKey);
        throw err;
      }
    })();

    this.probeCache.set(cacheKey, {
      promise: probePromise,
      expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
    });

    return probePromise;
  }

  invalidateProbe(providerId: string) {
    if (providerId) {
      for (const key of this.probeCache.keys()) {
        if (key.startsWith(`${providerId}:`)) {
          this.probeCache.delete(key);
        }
      }
    } else {
      this.probeCache.clear();
    }
  }
}
