import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProviderDiscovery } from '@agentctl/shared';
import type { ProviderStore } from './provider-store.js';
import { getHome } from './binary-installer.js';
import { jsonCodecs } from '../../db/json-codecs.js';
import type { Logger } from '../../logger.js';
const AUTO_UPDATE_FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;
const STALE_PACKAGE_CACHE_MS = 24 * 60 * 60 * 1000;

// Automatic updates only advance comparable release numbers. Other version formats
// remain available through the manual Update action.
function isNewerRelease(candidate: string, installed: string): boolean {
  const parse = (version: string): number[] | null => {
    const value = version.replace(/^v/, '');
    return /^\d+(?:\.\d+)*$/.test(value) ? value.split('.').map(Number) : null;
  };
  const next = parse(candidate);
  const current = parse(installed);
  if (!next || !current) return false;
  for (let index = 0; index < Math.max(next.length, current.length); index++) {
    const difference = (next[index] ?? 0) - (current[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** Update eligibility/backoff and orphan-cache retention; never owns installation candidates. */
export class ProviderUpdates {
  constructor(
    private readonly deps: {
      store: Pick<
        ProviderStore,
        'list' | 'listAll' | 'getSetting' | 'updateSetting' | 'deleteSetting'
      >;
      logger: Logger;
      install: (id: string) => Promise<ProviderDiscovery>;
    },
  ) {}
  private async prunePackageCaches(source: 'npx' | 'uvx'): Promise<void> {
    const cacheRoot = path.join(
      getHome(),
      source === 'npx' ? 'provider-npx-cache' : 'provider-uvx-cache',
    );
    let entries;
    try {
      entries = await fs.readdir(cacheRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.deps.logger.warn({ error, source }, 'Failed to list provider package caches');
      }
      return;
    }

    const activeCaches = new Set(
      this.deps.store
        .listAll()
        .filter((row) => row.installSource === source)
        .map(
          (row) =>
            jsonCodecs.stringRecord(row.launchEnv)[
              source === 'npx' ? 'npm_config_cache' : 'AGENTCTL_UVX_ROOT'
            ],
        )
        .filter((value): value is string => typeof value === 'string')
        .map((value) => path.resolve(value)),
    );
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{20}-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
      const cacheDir = path.join(cacheRoot, entry.name);
      if (activeCaches.has(path.resolve(cacheDir))) continue;
      try {
        const stats = await fs.stat(cacheDir);
        if (Date.now() - stats.mtimeMs < STALE_PACKAGE_CACHE_MS) continue;
        await fs.rm(cacheDir, { recursive: true, force: true });
      } catch (error) {
        this.deps.logger.warn(
          { error, cacheDir, source },
          'Failed to remove stale provider package cache',
        );
      }
    }
  }

  async run(): Promise<void> {
    for (const row of this.deps.store.list()) {
      if (
        row.registryAgentId ||
        !row.enabled ||
        (row.installState !== 'installed_local' && row.installState !== 'system_available') ||
        (row.installSource !== 'managed' &&
          row.installSource !== 'npx' &&
          row.installSource !== 'uvx') ||
        !row.installedVersion ||
        !row.version ||
        !isNewerRelease(row.version, row.installedVersion)
      ) {
        continue;
      }

      const failureKey = `providerAutoUpdateFailure:${row.id}`;
      const previousFailure = this.deps.store.getSetting(failureKey);
      if (previousFailure) {
        try {
          const failure = JSON.parse(previousFailure) as { version?: string; at?: number };
          if (
            failure.version === row.version &&
            typeof failure.at === 'number' &&
            Date.now() >= failure.at &&
            Date.now() - failure.at < AUTO_UPDATE_FAILURE_RETRY_MS
          ) {
            continue;
          }
        } catch {
          // Ignore a malformed retry record and attempt the update.
        }
      }

      try {
        const result = await this.deps.install(row.id);
        if (result.updateAvailable) {
          this.deps.store.updateSetting(
            failureKey,
            JSON.stringify({ version: row.version, at: Date.now() }),
          );
          this.deps.logger.warn(
            { providerId: row.id },
            'Automatic provider update failed verification',
          );
        } else {
          this.deps.store.deleteSetting(failureKey);
          this.deps.logger.info(
            { providerId: row.id, version: result.installedVersion },
            'Automatically updated provider',
          );
        }
      } catch (error) {
        this.deps.store.updateSetting(
          failureKey,
          JSON.stringify({ version: row.version, at: Date.now() }),
        );
        this.deps.logger.warn({ error, providerId: row.id }, 'Automatic provider update failed');
      }
    }
    await this.prunePackageCaches('npx');
    await this.prunePackageCaches('uvx');
  }
}
