import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { desc, lt, eq } from 'drizzle-orm';
import { registrySchema, type RegistryAgent } from '@agentctl/shared';
import { registrySnapshots } from '../../db/schema.js';
import type { DbClient } from '../../db/index.js';
import { type Logger, noopLogger } from '../../logger.js';

const CDN_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

export class RegistryFetcher {
  private readonly shutdown = new AbortController();
  private activeFetch?: Promise<RegistryAgent[]>;

  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
  ) {}

  getSnapshot() {
    const row = this.db
      .select()
      .from(registrySnapshots)
      .orderBy(desc(registrySnapshots.id))
      .limit(1)
      .all();
    return row.length > 0 ? row[0] : undefined;
  }

  getCachedAgents(): RegistryAgent[] | undefined {
    const snapshot = this.getSnapshot();
    if (!snapshot) return undefined;
    try {
      const data: unknown = JSON.parse(snapshot.data);
      const validated = registrySchema.parse(data);
      return this.mergeAgents(this.readLocalOverride(), validated.agents);
    } catch (error) {
      this.logger.warn(error, 'Ignoring invalid cached registry snapshot');
      return undefined;
    }
  }

  private async fetchRemote(headers: Record<string, string> = {}): Promise<Response> {
    const signal = AbortSignal.any([AbortSignal.timeout(8_000), this.shutdown.signal]);
    return fetch(CDN_URL, { headers, signal });
  }

  fetch(): Promise<RegistryAgent[]> {
    if (this.shutdown.signal.aborted) return Promise.reject(this.shutdown.signal.reason);
    if (this.activeFetch) return this.activeFetch;
    const request = this.fetchUncached();
    this.activeFetch = request;
    const clear = () => {
      if (this.activeFetch === request) this.activeFetch = undefined;
    };
    void request.then(clear, clear);
    return request;
  }

  private async fetchUncached(): Promise<RegistryAgent[]> {
    const localAgents = this.readLocalOverride();
    const lastSnapshot = this.getSnapshot();

    const headers: Record<string, string> = {};
    if (lastSnapshot?.etag) headers['If-None-Match'] = lastSnapshot.etag;
    if (lastSnapshot?.lastModified) headers['If-Modified-Since'] = lastSnapshot.lastModified;

    try {
      const response = await this.fetchRemote(headers);

      if (response.status === 304 && lastSnapshot) {
        const safe = registrySchema.safeParse(JSON.parse(lastSnapshot.data));
        if (safe.success) {
          return this.mergeAgents(localAgents, safe.data.agents);
        }
        this.logger.warn('Cached registry snapshot is stale/invalid; refetching fresh');
        return await this.fetchFresh(localAgents);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch registry CDN: ${String(response.status)}`);
      }

      const data: unknown = await response.json();
      const validated = registrySchema.parse(data);

      this.persistSnapshot(
        data,
        response.headers.get('etag'),
        response.headers.get('last-modified'),
      );

      return this.mergeAgents(localAgents, validated.agents);
    } catch (err) {
      this.shutdown.signal.throwIfAborted();
      this.logger.warn(err, 'Failed to fetch remote registry, falling back to cache');
      if (lastSnapshot) {
        try {
          const data: unknown = JSON.parse(lastSnapshot.data);
          const validated = registrySchema.parse(data);
          return this.mergeAgents(localAgents, validated.agents);
        } catch (e) {
          this.logger.error(e, 'Cached snapshot is invalid; clearing stale snapshot');
          this.clearSnapshot();
        }
      }
      if (localAgents.length > 0) return localAgents;
      throw err;
    }
  }

  get isDisposed(): boolean {
    return this.shutdown.signal.aborted;
  }

  /** The registry owns this fetcher; shutdown aborts acquisition before draining sync. */
  dispose(): void {
    this.shutdown.abort(new Error('Provider registry is disposed'));
  }

  private async fetchFresh(localAgents: RegistryAgent[]): Promise<RegistryAgent[]> {
    const response = await this.fetchRemote();
    if (!response.ok) {
      throw new Error(`Failed to fetch registry CDN: ${String(response.status)}`);
    }
    const data: unknown = await response.json();
    const validated = registrySchema.parse(data);
    this.persistSnapshot(data, response.headers.get('etag'), response.headers.get('last-modified'));
    return this.mergeAgents(localAgents, validated.agents);
  }

  private clearSnapshot(): void {
    const latest = this.getSnapshot();
    if (latest) {
      this.db.delete(registrySnapshots).where(eq(registrySnapshots.id, latest.id)).run();
    }
  }

  private readLocalOverride(): RegistryAgent[] {
    const localPath =
      process.env.AGENTCTL_REGISTRY_PATH ??
      path.join(process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl'), 'registry.json');
    if (fs.existsSync(localPath)) {
      try {
        const content: unknown = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        if (typeof content !== 'object' || content === null) {
          throw new Error('Local registry override must be an object');
        }
        const validated = registrySchema.parse({
          version: 'local',
          extensions: [],
          ...(content as Record<string, unknown>),
        });
        return validated.agents;
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

  private persistSnapshot(data: unknown, etag: string | null, lastModified: string | null): void {
    this.db
      .insert(registrySnapshots)
      .values({
        data: JSON.stringify(data),
        etag,
        lastModified,
        fetchedAt: new Date(),
      })
      .run();

    const latest = this.getSnapshot();
    if (latest) {
      this.db.delete(registrySnapshots).where(lt(registrySnapshots.id, latest.id)).run();
    }
  }
}
