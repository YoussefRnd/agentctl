import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  ClientSideConnection,
  ndJsonStream,
  type SessionNotification,
  type RequestPermissionRequest,
  type Stream,
  type AnyMessage,
  type Client,
} from '@agentclientprotocol/sdk';
import type { ProviderData } from '../provider.js';
import type { ProviderStore } from './provider-store.js';
import type { RegistryFetcher } from './registry-fetcher.js';
import { parseRegistryAgents } from '../provider-registry.js';
import { ProcessStreamTransport, cleanEnv } from '../../acp/transport/process-transport.js';
import { resolveAllowedPath } from '../../acp/transport/path-security.js';
import { parseNotificationToEvents } from '../../acp/protocol/events.js';
import { AcpDebugLog } from '../../acp/runtime.js';
import { initializeAcpConnection } from '../../acp/transport/capabilities-cache.js';
import type {
  SessionCallbacks,
  RuntimeOptions,
  PermissionToolCall,
  DomainPermissionRequest,
} from '../../acp/types.js';
import { type Logger, noopLogger } from '../../logger.js';
import { TerminalManager } from '../../acp/protocol/terminal-manager.js';
import { type RegistryAgent } from '@agentctl/shared';

const PERSISTENT_CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PersistentConnection {
  connection: ClientSideConnection;
  child: ChildProcess;
  transport: ProcessStreamTransport;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
  sessions: Map<string, { sessionId: string; createdAt: number }>;
  debugLog: AcpDebugLog;
  promptCapabilities?: unknown;
  supportsResumeSession?: boolean;
  supportsCloseSession?: boolean;
  supportsDeleteSession?: boolean;
  supportsListSessions?: boolean;
  supportsAdditionalDirectories?: boolean;
  terminalManager: TerminalManager;
}

export interface ActiveSession {
  acpSessionId: string;
  localSessionId: string;
  options: RuntimeOptions;
  callbacks: SessionCallbacks;
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

function wrapDebug(stream: Stream, debugLog: AcpDebugLog): Stream {
  const { readable, writable } = stream;
  const reader = readable.getReader();
  const loggedReadable = new ReadableStream<AnyMessage>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      debugLog.recordLine('incoming', JSON.stringify(value));
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const writer = writable.getWriter();
  const loggedWritable = new WritableStream<AnyMessage>({
    async write(chunk) {
      debugLog.recordLine('outgoing', JSON.stringify(chunk));
      await writer.write(chunk);
    },
    close() {
      return writer.close();
    },
    abort(reason) {
      return writer.abort(reason);
    },
  });

  return { readable: loggedReadable, writable: loggedWritable };
}

export class PersistentAgentConnectionManager {
  private connections = new Map<string, PersistentConnection>();
  private activeSessions = new Map<string, ActiveSession>(); // key: acpSessionId
  private terminalToSession = new Map<string, string>(); // key: terminalId, value: acpSessionId

  constructor(
    private store: ProviderStore,
    private fetcher: RegistryFetcher,
    private logger: Logger = noopLogger,
  ) {}

  registerActiveSession(acpSessionId: string, session: ActiveSession) {
    this.activeSessions.set(acpSessionId, session);
  }

  unregisterActiveSession(acpSessionId: string) {
    this.activeSessions.delete(acpSessionId);
    for (const [termId, sessId] of this.terminalToSession.entries()) {
      if (sessId === acpSessionId) {
        this.terminalToSession.delete(termId);
      }
    }
  }

  writeTerminalInput(terminalId: string, data: string): boolean {
    for (const conn of this.connections.values()) {
      const term = conn.terminalManager.getTerminal(terminalId);
      if (term) {
        return conn.terminalManager.write(terminalId, data);
      }
    }
    return false;
  }

  getProviderIdByCommand(command: string): string | undefined {
    return this.store.listAll().find((p) => p.command === command)?.id;
  }

  async getConnection(providerId: string): Promise<PersistentConnection> {
    const conn = this.connections.get(providerId);
    if (conn && !conn.child.killed) {
      conn.lastUsed = Date.now();
      this.resetIdleTimer(conn);
      return conn;
    }

    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);
    if (!agent) throw new Error(`Registry agent data not found for ${providerId}`);

    const launch = resolveLaunch(provider, agent);
    return await this.createPersistentConnection(providerId, launch);
  }

  private async createPersistentConnection(
    providerId: string,
    launch: { command: string; args: string[]; env: Record<string, string> },
  ): Promise<PersistentConnection> {
    const activeSessions = this.activeSessions;
    const terminalToSession = this.terminalToSession;
    const logger = this.logger;
    const debugLog = new AcpDebugLog();
    const child = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(launch.env),
      cwd: os.tmpdir(),
    });

    const transport = new ProcessStreamTransport(child, this.logger);
    const rawStream = ndJsonStream(transport.stdin, transport.stdout);
    const stream = wrapDebug(rawStream, debugLog);

    child.stderr.on('data', (data: Buffer) => {
      debugLog.recordLine('stderr', data.toString());
    });

    const terminalManager = new TerminalManager(this.logger);

    const connection = new ClientSideConnection((_connectionInstance) => {
      const getSessionContext = (params: { sessionId?: string } | undefined) => {
        const acpSessionId = params?.sessionId;
        if (!acpSessionId) {
          throw new Error('Missing sessionId in request');
        }
        const session = activeSessions.get(acpSessionId);
        if (!session) {
          throw new Error(`Session ${acpSessionId} not found or inactive`);
        }
        return session;
      };

      return {
        async sessionUpdate(n: SessionNotification) {
          const acpSessionId = n.sessionId;
          if (!acpSessionId) return;
          const session = activeSessions.get(acpSessionId);
          if (!session) {
            debugLog.recordLine(
              'incoming',
              `Ignoring sessionUpdate for inactive session: ${acpSessionId}`,
            );
            return;
          }
          const events = parseNotificationToEvents(n);
          for (const event of events) {
            await session.callbacks.onEvent(event);
          }
        },
        async requestPermission(r: RequestPermissionRequest) {
          const session = getSessionContext(r);
          const toolCall = r.toolCall as unknown as PermissionToolCall;
          const rawInput = toolCall.rawInput as Record<string, unknown> | undefined;

          let parsedName = typeof toolCall.name === 'string' ? toolCall.name : '';
          if (!parsedName && toolCall.toolCallId) {
            parsedName = toolCall.toolCallId.split('__')[0];
          }
          if (!parsedName) {
            parsedName = typeof toolCall.kind === 'string' ? toolCall.kind : 'tool';
          }

          let parsedArgs = toolCall.arguments;
          if (!parsedArgs) {
            if (rawInput && typeof rawInput === 'object') {
              if (rawInput.arguments && typeof rawInput.arguments === 'object') {
                parsedArgs = rawInput.arguments as Record<string, unknown>;
              } else {
                const rest = { ...rawInput };
                delete rest.name;
                delete rest.arguments;
                parsedArgs = rest;
              }
            }
          }
          if (!parsedArgs) {
            const locations = toolCall.locations;
            const primaryPath =
              locations?.[0]?.path ??
              (typeof toolCall.title === 'string' ? toolCall.title : undefined);
            if (primaryPath) {
              parsedArgs = {
                path: primaryPath,
                TargetFile: primaryPath,
                AbsolutePath: primaryPath,
              };
            }
          }

          const domainReq: DomainPermissionRequest = {
            permissionId: toolCall.toolCallId ?? '',
            description: typeof toolCall.title === 'string' ? toolCall.title : '',
            options: r.options.map((opt) => ({
              optionId: opt.optionId,
              label: opt.name,
              kind: opt.kind,
            })),
            toolCall: {
              name: parsedName,
              arguments: parsedArgs,
              toolCallId: toolCall.toolCallId,
            },
          };
          const domainResp = await session.callbacks.onRequestPermission(domainReq);
          if (domainResp.allowed && domainResp.optionId) {
            return {
              outcome: { outcome: 'selected', optionId: domainResp.optionId },
            };
          }
          return { outcome: { outcome: 'cancelled' } };
        },
        async 'fs.readTextFile'(p: { sessionId: string; path: string }) {
          const session = getSessionContext(p);
          const absPath = resolveAllowedPath(
            p.path,
            session.options.cwd,
            session.options.additionalDirectories,
          );
          const content = fs.readFileSync(absPath, 'utf8');
          return Promise.resolve({ content });
        },
        async 'fs.writeTextFile'(p: { sessionId: string; path: string; content: string }) {
          const session = getSessionContext(p);
          const absPath = resolveAllowedPath(
            p.path,
            session.options.cwd,
            session.options.additionalDirectories,
            true,
          );
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, p.content, 'utf8');
          return Promise.resolve({});
        },
        async 'terminal/create'(p: {
          sessionId: string;
          command: string;
          args?: string[];
          cwd?: string;
          env?: Record<string, string>;
          outputByteLimit?: number;
        }) {
          const session = getSessionContext(p);
          const terminalCwd = resolveAllowedPath(
            p.cwd ?? session.options.cwd,
            session.options.cwd,
            session.options.additionalDirectories,
          );
          const terminalId = terminalManager.spawn({
            command: p.command,
            args: p.args,
            cwd: terminalCwd,
            env: p.env,
            outputByteLimit: p.outputByteLimit,
          });
          terminalToSession.set(terminalId, session.acpSessionId);
          await session.callbacks.onEvent({
            type: 'terminal_created',
            terminalId,
            command: p.command,
          });
          return Promise.resolve({ terminalId });
        },
        async 'terminal/release'(p: { sessionId: string; terminalId: string }) {
          terminalManager.release(p.terminalId);
          terminalToSession.delete(p.terminalId);
          return Promise.resolve({});
        },
        async 'terminal/output'(p: { sessionId: string; terminalId: string }) {
          const term = terminalManager.getTerminal(p.terminalId);
          if (!term) {
            return Promise.reject(new Error(`Terminal not found: ${p.terminalId}`));
          }
          const exitStatus = term.hasExited
            ? { exitCode: term.exitCode, signal: term.signal as NodeJS.Signals | null }
            : undefined;
          return Promise.resolve({
            output: term.output,
            truncated: term.truncated,
            ...(exitStatus ? { exitStatus } : {}),
          });
        },
        async 'terminal/wait_for_exit'(p: { sessionId: string; terminalId: string }) {
          const term = terminalManager.getTerminal(p.terminalId);
          if (!term) {
            return Promise.reject(new Error(`Terminal not found: ${p.terminalId}`));
          }
          const res = await term.closed;
          return Promise.resolve({
            exitCode: res.exitCode,
            signal: res.signal as NodeJS.Signals | null,
          });
        },
        async 'terminal/kill'(p: { sessionId: string; terminalId: string }) {
          terminalManager.kill(p.terminalId);
          return Promise.resolve({});
        },
        async 'terminal/write'(p: { sessionId: string; terminalId: string; data: string }) {
          const ok = terminalManager.write(p.terminalId, p.data);
          if (!ok) {
            return Promise.reject(new Error(`Failed to write to terminal ${p.terminalId}`));
          }
          return Promise.resolve({});
        },
      } as unknown as Client;
    }, stream);

    terminalManager.on('output', (event) => {
      const { terminalId, data } = event as { terminalId: string; data: string };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const session = activeSessions.get(acpSessionId);
        if (session) {
          void session.callbacks.onEvent({ type: 'terminal_output', terminalId, data });
        }
      }
    });

    terminalManager.on('exit', (event) => {
      const { terminalId, code } = event as { terminalId: string; code: number | null };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const session = activeSessions.get(acpSessionId);
        if (session) {
          void session.callbacks.onEvent({ type: 'terminal_exit', terminalId, code });
        }
      }
    });

    const acpInitRes = await initializeAcpConnection(connection, {
      transport,
      timeoutMs: 60_000,
    });
    const parsedCapabilities = acpInitRes.parsedCapabilities;
    const agentCaps = (acpInitRes.initResult as { agentCapabilities?: { prompt?: unknown } })
      .agentCapabilities;

    const persistentConn: PersistentConnection = {
      connection,
      child,
      transport,
      lastUsed: Date.now(),
      idleTimer: null,
      sessions: new Map(),
      debugLog,
      promptCapabilities: agentCaps?.prompt,
      supportsResumeSession: parsedCapabilities.supportsResumeSession,
      supportsCloseSession: parsedCapabilities.supportsCloseSession,
      supportsDeleteSession: parsedCapabilities.supportsDeleteSession,
      supportsListSessions: parsedCapabilities.supportsListSessions,
      supportsAdditionalDirectories: parsedCapabilities.supportsAdditionalDirectories,
      terminalManager,
    };

    this.connections.set(providerId, persistentConn);
    this.resetIdleTimer(persistentConn);

    child.once('exit', (code, signal) => {
      logger.info(
        { providerId, code, signal },
        `Persistent agent process exited for provider ${providerId}`,
      );
      this.closeConnection(providerId);
    });

    return persistentConn;
  }

  private resetIdleTimer(conn: PersistentConnection) {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
    }
    conn.idleTimer = setTimeout(() => {
      if (conn.sessions.size === 0) {
        this.logger.info(`Closing idle persistent connection`);
        this.closeConnectionByInstance(conn);
      }
    }, PERSISTENT_CONNECTION_IDLE_TIMEOUT_MS);
  }

  async closeSession(providerId: string, acpSessionId: string): Promise<void> {
    const conn = this.connections.get(providerId);
    if (!conn) return;

    conn.sessions.delete(acpSessionId);
    this.unregisterActiveSession(acpSessionId);

    if (conn.supportsCloseSession) {
      try {
        await conn.connection.closeSession({ sessionId: acpSessionId });
      } catch (err) {
        this.logger.warn({ err, acpSessionId }, `Failed to close session on agent`);
      }
    }

    if (conn.sessions.size === 0) {
      this.resetIdleTimer(conn);
    }
  }

  closeConnection(providerId: string) {
    const conn = this.connections.get(providerId);
    if (conn) {
      this.closeConnectionByInstance(conn);
      this.connections.delete(providerId);
    }
  }

  private closeConnectionByInstance(conn: PersistentConnection) {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
      conn.idleTimer = null;
    }
    void conn.terminalManager.dispose();
    conn.transport.kill();
  }

  closeAll() {
    for (const providerId of this.connections.keys()) {
      this.closeConnection(providerId);
    }
  }
}

function resolveLaunch(
  provider: ProviderData,
  agent: RegistryAgent,
): { command: string; args: string[]; env: Record<string, string> } {
  let command = provider.command;
  let args = JSON.parse(provider.launchArgs || '[]') as string[];
  const launchEnv = JSON.parse(provider.launchEnv || '{}') as Record<string, string>;
  const customEnv = JSON.parse(provider.customEnv || '{}') as Record<string, string>;

  if (command === 'npx' || command === 'uvx') {
    const candidateBinaries = packageToBinaryMap[agent.id] ?? [agent.id];
    for (const bin of candidateBinaries) {
      const foundPath = findBinaryOnPath(bin);
      if (foundPath) {
        command = foundPath;
        args = [];
        break;
      }
    }
  }

  const mergedEnv = {
    ...pickProxyEnv(process.env),
    ...launchEnv,
    ...customEnv,
  };

  return { command, args, env: mergedEnv };
}
