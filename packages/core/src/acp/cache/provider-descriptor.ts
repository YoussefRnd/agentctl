import { capabilitySnapshotSchema } from '@agentctl/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDescriptor } from '../../agent/types.js';
import type { CacheStorage } from '../types.js';
import { withCacheWriterLock } from './writer-lock.js';

interface Entry {
  ts: number;
  result: AgentDescriptor;
}
type Manifest = Record<string, Entry>;
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 256;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const writers = new Map<string, Promise<void>>();

/** Bounded read-through cache; file writes are asynchronous, atomic and serialized. */
export class FileCacheStorage implements CacheStorage {
  private manifest: Manifest = {};
  private stamp?: string;
  private readonly file: string;
  constructor(file: string) {
    this.file = path.resolve(file);
  }

  private prune(manifest: Manifest): Manifest {
    const cutoff = Date.now() - TTL_MS;
    let bytes = 2;
    const entries = Object.entries(manifest)
      .filter(([, entry]) => entry?.result && Number.isFinite(entry.ts) && entry.ts > cutoff)
      .sort((a, b) => b[1].ts - a[1].ts);
    const retained: [string, Entry][] = [];
    for (const [key, entry] of entries) {
      const size = Buffer.byteLength(JSON.stringify({ [key]: entry })) - 2;
      if (size > 512 * 1024 || size > MAX_MANIFEST_BYTES - bytes || retained.length >= MAX_ENTRIES)
        continue;
      bytes += size + 1;
      retained.push([key, entry]);
    }
    return Object.fromEntries(retained);
  }

  private async read(force = false): Promise<Manifest> {
    try {
      const stat = await fs.stat(this.file, { bigint: true });
      if (stat.size > BigInt(MAX_MANIFEST_BYTES)) {
        this.manifest = {};
        this.stamp = undefined;
        return {};
      }
      const stamp = `${stat.mtimeNs}:${stat.size}`;
      if (force || stamp !== this.stamp) {
        const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'));
        this.manifest =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? this.prune(parsed as Manifest)
            : {};
        this.stamp = stamp;
      }
      return this.manifest;
    } catch {
      this.stamp = undefined;
      this.manifest = {};
      return this.manifest;
    }
  }

  async get(key: string): Promise<AgentDescriptor | null> {
    await writers.get(this.file);
    const manifest = await this.read();
    const entry = manifest[key];
    if (entry && entry.ts <= Date.now() - TTL_MS) {
      delete manifest[key];
      return null;
    }
    const result = entry?.result;
    if (!result) return null;
    if (!result.snapshot) return structuredClone(result);
    const snapshot = capabilitySnapshotSchema.safeParse(result.snapshot);
    return snapshot.success ? structuredClone({ ...result, snapshot: snapshot.data }) : null;
  }

  private async mutate(operation: (manifest: Manifest) => Manifest): Promise<void> {
    const previous = writers.get(this.file) ?? Promise.resolve();
    const work = previous
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await withCacheWriterLock(this.file, async () => {
          const temporary = `${this.file}.${randomUUID()}.tmp`;
          try {
            const manifest = this.prune(operation({ ...(await this.read(true)) }));
            await fs.writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
            await fs.rename(temporary, this.file);
            this.manifest = manifest;
            this.stamp = undefined;
          } finally {
            await fs.unlink(temporary).catch(() => undefined);
          }
        });
      })
      .catch(() => {
        this.stamp = undefined;
      });
    writers.set(this.file, work);
    try {
      await work;
    } finally {
      if (writers.get(this.file) === work) writers.delete(this.file);
    }
  }

  set(key: string, result: AgentDescriptor): Promise<void> {
    const snapshot = structuredClone(result);
    return this.mutate((manifest) => ({
      ...manifest,
      [key]: { ts: Date.now(), result: snapshot },
    }));
  }
  delete(key: string): Promise<void> {
    return this.mutate((manifest) => {
      delete manifest[key];
      return manifest;
    });
  }
  clear(): Promise<void> {
    return this.mutate(() => ({}));
  }
}
