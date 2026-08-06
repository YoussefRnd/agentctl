import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROTOCOL_VERSION, type ClientSideConnection } from '@agentclientprotocol/sdk';
import type {
  CacheStorage,
  AgentProbeResult,
  AcpParsedCapabilities,
  InitializeAcpConnectionOptions,
} from '../types.js';

export class FileCacheStorage implements CacheStorage {
  private static readonly TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly manifestFilePath: string) {}

  private readManifest(): Record<string, { ts?: number; result?: AgentProbeResult }> {
    try {
      if (fs.existsSync(this.manifestFilePath)) {
        const content = fs.readFileSync(this.manifestFilePath, 'utf8');
        return JSON.parse(content) as Record<string, { ts?: number; result?: AgentProbeResult }>;
      }
    } catch {
      // Ignore reading errors, return empty
    }
    return {};
  }

  async get(key: string): Promise<AgentProbeResult | null> {
    const manifest = this.readManifest();
    const entry = manifest[key];
    // Record index access can be undefined at runtime even though the
    // declared type omits undefined (noUncheckedIndexedAccess is off).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!entry?.result) return null;
    if (!entry.ts || Date.now() - entry.ts > FileCacheStorage.TTL_MS) return null;
    return Promise.resolve(entry.result);
  }

  async set(key: string, value: AgentProbeResult): Promise<void> {
    try {
      const dir = path.dirname(this.manifestFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const manifest = this.readManifest();
      manifest[key] = { result: value, ts: Date.now() };
      fs.writeFileSync(this.manifestFilePath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch {
      // Ignore write errors
    }
    return Promise.resolve();
  }
}

export function getCacheKey(command: string, args: string[], env: Record<string, string>): string {
  const data = JSON.stringify({ command, args, env });
  return crypto.hash('sha256', data);
}

export function sessionSupportsDelete(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') {
    return false;
  }
  return Boolean((caps as { delete?: unknown }).delete);
}

export function sessionSupportsClose(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { close?: unknown }).close);
}

export function sessionSupportsResume(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') return false;
  return Boolean((caps as { resume?: unknown }).resume);
}

export function parseAcpCapabilities(agentCapabilities: unknown): AcpParsedCapabilities {
  const agentCapsObj = agentCapabilities as
    | {
        sessionCapabilities?: Record<string, unknown>;
        loadSession?: boolean;
        promptCapabilities?: { embeddedContext?: boolean };
      }
    | undefined;
  const caps = agentCapsObj?.sessionCapabilities;
  const supportsResume = !!caps?.resume;
  const supportsLoad = Boolean(agentCapsObj?.loadSession) || Boolean(caps?.load) || supportsResume;
  return {
    supportsResumeSession: supportsResume,
    supportsCloseSession: !!caps?.close,
    supportsDeleteSession: sessionSupportsDelete(caps),
    supportsListSessions: !!caps?.list,
    supportsAdditionalDirectories: !!caps?.additionalDirectories,
    supportsLoadSession: supportsLoad,
    supportsEmbeddedContext: Boolean(agentCapsObj?.promptCapabilities?.embeddedContext),
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function initializeAcpConnection(
  connection: Pick<ClientSideConnection, 'initialize'>,
  options: InitializeAcpConnectionOptions = {},
) {
  const clientInfo = options.clientInfo ?? {
    name: 'agentctl',
    title: 'Agentctl',
    version: '1.0.0',
  };
  const clientCapabilities = options.clientCapabilities ?? {
    terminal: true,
    fs: { readTextFile: true, writeTextFile: true },
    _meta: { builtin: { bash: true }, session: { model: true } },
  };

  const initPromise = connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: clientCapabilities,
    clientInfo,
  });

  const promises: Promise<unknown>[] = [initPromise];
  if (options.transport) {
    promises.push(
      options.transport.closed.then(() => {
        throw new Error('ACP agent process exited before initialization completed');
      }),
    );
  }

  const racePromise = Promise.race(promises);
  const rawResult = options.timeoutMs
    ? await withTimeout(racePromise, options.timeoutMs, 'initializing ACP connection')
    : await racePromise;

  const initResult = rawResult as { agentCapabilities?: unknown };
  const parsedCapabilities = parseAcpCapabilities(initResult.agentCapabilities);

  return { initResult, parsedCapabilities };
}
