import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { RegistryAgent } from '@agentctl/shared';
import type { ProviderStore } from './provider-store.js';
import type { BinaryInstaller } from './binary-installer.js';

const execFilePromise = promisify(execFile);

const PROBE_CACHE_TTL_MS = 60_000;

function findBinaryOnPath(command: string): string | null {
  const pathEnv = process.env.PATH || '';
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
  promise: Promise<any>;
  expiresAt: number;
}

export class ProviderLauncher {
  private probeCache = new Map<string, CacheEntry>();

  constructor(
    private store: ProviderStore,
    private installer: BinaryInstaller
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

  resolveLaunch(provider: any, registryAgent?: RegistryAgent, options?: { force?: boolean }) {
    let command = provider.command;
    let args = JSON.parse(provider.launchArgs || '[]');
    let env = JSON.parse(provider.launchEnv || '{}');

    if (registryAgent?.distribution?.npx) {
      const pkg = registryAgent.distribution.npx.package;
      const candidateBinaries = packageToBinaryMap[pkg] || [pkg.split('/').pop() || ''];
      let localBinaryPath: string | null = null;
      for (const bin of candidateBinaries) {
        localBinaryPath = findBinaryOnPath(bin);
        if (localBinaryPath) break;
      }

      if (localBinaryPath) {
        command = localBinaryPath;
        args = registryAgent.distribution.npx.args ?? [];
        env = registryAgent.distribution.npx.env ?? {};
      } else {
        command = 'npx';
        args = ['-y', pkg, ...(registryAgent.distribution.npx.args ?? [])];
        env = registryAgent.distribution.npx.env ?? {};
      }
    } else if (registryAgent?.distribution?.uvx) {
      const pkg = registryAgent.distribution.uvx.package;
      const binName = pkg.split('/').pop() || '';
      const localBinaryPath = findBinaryOnPath(binName);
      if (localBinaryPath) {
        command = localBinaryPath;
        args = registryAgent.distribution.uvx.args ?? [];
        env = registryAgent.distribution.uvx.env ?? {};
      } else {
        command = 'uvx';
        args = [pkg, ...(registryAgent.distribution.uvx.args ?? [])];
        env = registryAgent.distribution.uvx.env ?? {};
      }
    } else if (provider.installState === 'system_available') {
      throw new Error('Registry agent metadata required for system_available providers');
    }

    const customEnv = JSON.parse(provider.customEnv || '{}');
    env = { ...env, ...customEnv };

    return { command, args, env };
  }

  async probe(providerId: string, runtime: any, agent: RegistryAgent, options?: { force?: boolean }) {
    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const launch = this.resolveLaunch(provider, agent, options);
    const hash = crypto.createHash('sha256').update(JSON.stringify(launch)).digest('hex');
    const cacheKey = `${providerId}:${hash}`;

    const cached = this.probeCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.promise;
    }

    const probePromise = (async () => {
      try {
        const result = await runtime.probe(launch.command, launch.args, launch.env);
        this.store.setAuthState(providerId, result.status === 'ready' ? 'authenticated' : result.status);
        return result;
      } catch (err) {
        this.store.setAuthState(providerId, 'error');
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
