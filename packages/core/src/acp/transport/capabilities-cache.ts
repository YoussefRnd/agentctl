import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  PROTOCOL_VERSION,
  type ClientCapabilities,
  type ClientSideConnection,
  type InitializeResponse,
} from '@agentclientprotocol/sdk';
import type {
  CacheStorage,
  AcpParsedCapabilities,
  InitializeAcpConnectionOptions,
} from '../types.js';
import type { AgentDescriptor } from '../../agent/types.js';
import { capabilitySnapshotSchema } from '@agentctl/shared';
import { withTimeout } from './acp-process-lifecycle.js';
export { withTimeout };

export const AGENTCTL_CLIENT_CAPABILITIES: ClientCapabilities = {
  terminal: true,
  ...(process.platform === 'win32' ? {} : { auth: { terminal: true } }),
  fs: { readTextFile: true, writeTextFile: true },
  session: { configOptions: { boolean: {} } },
  elicitation: { form: {}, url: {} },
  _meta: {
    'agentctl.dev': {
      extensionMethods: ['_agentctl.dev/builtin/bash', '_agentctl.dev/terminal/write'],
      extensionMethodPrefixes: ['_agentctl.dev/mcp/'],
    },
  },
};

export class FileCacheStorage implements CacheStorage {
  private static readonly TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly manifestFilePath: string) {}

  private readManifest(): Record<string, { ts?: number; result?: AgentDescriptor }> {
    try {
      if (fs.existsSync(this.manifestFilePath)) {
        const content = fs.readFileSync(this.manifestFilePath, 'utf8');
        return JSON.parse(content) as Record<string, { ts?: number; result?: AgentDescriptor }>;
      }
    } catch {
      // Ignore reading errors, return empty
    }
    return {};
  }

  async get(key: string): Promise<AgentDescriptor | null> {
    const manifest = this.readManifest();
    const entry = manifest[key];
    // Record index access can be undefined at runtime even though the
    // declared type omits undefined (noUncheckedIndexedAccess is off).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!entry?.result) return null;
    if (!entry.ts || Date.now() - entry.ts > FileCacheStorage.TTL_MS) return null;
    if (!entry.result.snapshot) return Promise.resolve(entry.result);
    const snapshot = capabilitySnapshotSchema.safeParse(entry.result.snapshot);
    if (!snapshot.success) return null;
    return Promise.resolve({ ...entry.result, snapshot: snapshot.data });
  }

  async set(key: string, value: AgentDescriptor): Promise<void> {
    try {
      const dir = path.dirname(this.manifestFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const manifest = this.readManifest();
      manifest[key] = { result: value, ts: Date.now() };
      this.writeManifest(manifest);
    } catch {
      // Ignore write errors
    }
    return Promise.resolve();
  }

  async delete(key: string): Promise<void> {
    try {
      const manifest = this.readManifest();
      if (key in manifest) {
        delete manifest[key];
        this.writeManifest(manifest);
      }
    } catch {
      // Ignore write errors
    }
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.manifestFilePath)) {
        fs.unlinkSync(this.manifestFilePath);
      }
    } catch {
      // Ignore unlink errors
    }
    return Promise.resolve();
  }

  private writeManifest(manifest: Record<string, { ts?: number; result?: AgentDescriptor }>): void {
    const temporaryPath = `${this.manifestFilePath}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.manifestFilePath);
  }
}

function executableFingerprint(command: string, env: Record<string, string>): string | null {
  const candidates = command.includes(path.sep)
    ? [command]
    : (env.PATH ?? process.env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, command));

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return `${candidate}:${String(stat.size)}:${String(stat.mtimeMs)}`;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

export function getCacheKey(
  command: string,
  args: string[],
  env: Record<string, string>,
  options?: { providerVersion?: string; protocolVersion?: string },
): string {
  const sortedEnv: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) {
    sortedEnv[k] = env[k];
  }
  const data = JSON.stringify({
    schemaVersion: 3,
    command,
    args,
    env: sortedEnv,
    executable: executableFingerprint(command, env),
    providerVersion: options?.providerVersion,
    protocolVersion: options?.protocolVersion,
  });
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
        promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
      }
    | undefined;
  const caps = agentCapsObj?.sessionCapabilities;
  const supportsResume = Boolean(caps?.resume);
  return {
    supportsForkSession: Boolean(caps?.fork),
    supportsResumeSession: supportsResume,
    supportsCloseSession: !!caps?.close,
    supportsDeleteSession: sessionSupportsDelete(caps),
    supportsListSessions: !!caps?.list,
    supportsAdditionalDirectories: !!caps?.additionalDirectories,
    supportsLoadSession: Boolean(agentCapsObj?.loadSession),
    supportsImage: Boolean(agentCapsObj?.promptCapabilities?.image),
    supportsAudio: Boolean(agentCapsObj?.promptCapabilities?.audio),
    supportsEmbeddedContext: Boolean(agentCapsObj?.promptCapabilities?.embeddedContext),
  };
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
  const clientCapabilities: ClientCapabilities = options.clientCapabilities ?? {};

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

  const initResult = rawResult as InitializeResponse;
  if (initResult.protocolVersion !== PROTOCOL_VERSION) {
    options.transport?.kill();
    throw new Error(
      `Unsupported ACP protocol version ${String(initResult.protocolVersion)}; expected ${String(PROTOCOL_VERSION)}`,
    );
  }
  const parsedCapabilities = parseAcpCapabilities(initResult.agentCapabilities);

  return { initResult, parsedCapabilities };
}
