import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { desc, lt, eq } from 'drizzle-orm';
import { registrySchema, type RegistryAgent } from '@agentctl/shared';
import { registrySnapshots } from '../../db/schema.js';
import type { DbClient } from '../acp-session.js';
import { type Logger, noopLogger } from '../../logger.js';

const CDN_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

export class RegistryFetcher {
  constructor(private db: DbClient, private logger: Logger = noopLogger) {}

  async getSnapshot() {
    const row = await this.db.select().from(registrySnapshots).orderBy(desc(registrySnapshots.id)).limit(1).all();
    return row[0];
  }

  async fetch(): Promise<RegistryAgent[]> {
    const localAgents = this.readLocalOverride();
    const lastSnapshot = await this.getSnapshot();

    const headers: Record<string, string> = {};
    if (lastSnapshot?.etag) headers['If-None-Match'] = lastSnapshot.etag;
    if (lastSnapshot?.lastModified) headers['If-Modified-Since'] = lastSnapshot.lastModified;

    try {
      const response = await fetch(CDN_URL, { headers });

      if (response.status === 304 && lastSnapshot) {
        const safe = registrySchema.safeParse(JSON.parse(lastSnapshot.data));
        if (safe.success) {
          return this.mergeAgents(localAgents, safe.data.agents);
        }
        // Stale/invalid cached snapshot (registry schema changed since it was stored).
        // The matching etag would keep returning 304 with corrupt data, so ignore it
        // and pull a fresh copy.
        this.logger.warn('Cached registry snapshot is stale/invalid; refetching fresh');
        return this.fetchFresh(localAgents);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch registry CDN: ${response.status}`);
      }

      const data = await response.json();
      const validated = registrySchema.parse(data); // Zod validation

      await this.persistSnapshot(data, response.headers.get('etag'), response.headers.get('last-modified'));

      return this.mergeAgents(localAgents, validated.agents);
    } catch (err) {
      this.logger.warn(err, 'Failed to fetch remote registry, falling back to cache');
      if (lastSnapshot) {
        try {
          const data = JSON.parse(lastSnapshot.data);
          const validated = registrySchema.parse(data);
          return this.mergeAgents(localAgents, validated.agents);
        } catch (e) {
          this.logger.error(e, 'Cached snapshot is invalid; clearing stale snapshot');
          await this.clearSnapshot();
        }
      }
      return localAgents;
    }
  }

  private async fetchFresh(localAgents: RegistryAgent[]): Promise<RegistryAgent[]> {
    const response = await fetch(CDN_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch registry CDN: ${response.status}`);
    }
    const data = await response.json();
    const validated = registrySchema.parse(data);
    await this.persistSnapshot(data, response.headers.get('etag'), response.headers.get('last-modified'));
    return this.mergeAgents(localAgents, validated.agents);
  }

  private async clearSnapshot(): Promise<void> {
    const latest = await this.getSnapshot();
    if (latest) {
      await this.db.delete(registrySnapshots).where(eq(registrySnapshots.id, latest.id)).run();
    }
  }

  private readLocalOverride(): RegistryAgent[] {
    const localPath = process.env.AGENTCTL_REGISTRY_PATH ?? path.join(os.homedir(), '.agentctl', 'registry.json');
    if (fs.existsSync(localPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        return content.agents ?? [];
      } catch (err) {
        this.logger.warn(err, 'Failed to read local override file');
      }
    }
    return [];
  }

  private mergeAgents(local: RegistryAgent[], remote: RegistryAgent[]): RegistryAgent[] {
    const map = new Map<string, RegistryAgent>();
    for (const a of remote) map.set(a.id, a);
    for (const a of local) map.set(a.id, a);
    return Array.from(map.values());
  }

  private async persistSnapshot(data: any, etag: string | null, lastModified: string | null): Promise<void> {
    await this.db.insert(registrySnapshots).values({
      data: JSON.stringify(data),
      etag,
      lastModified,
      fetchedAt: new Date()
    }).run();

    const latest = await this.getSnapshot();
    if (latest) {
      await this.db.delete(registrySnapshots).where(lt(registrySnapshots.id, latest.id)).run();
    }
  }
}
