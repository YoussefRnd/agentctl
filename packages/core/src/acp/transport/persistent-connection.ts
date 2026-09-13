import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { ProviderLauncher } from '../../providers/registry/provider-launcher.js';
import type { ProviderStore } from '../../providers/registry/provider-store.js';
import type { RegistryFetcher } from '../../providers/registry/registry-fetcher.js';
import { parseRegistryAgents } from '../../providers/provider-registry.js';
import { ProcessStreamTransport, cleanEnv } from './process-transport.js';
import { createClientHandlers } from '../protocol/client-handlers.js';
import { AcpDebugLog, wrapDebug, formatAcpMessageLog } from './stream-debug.js';
import { AGENTCTL_CLIENT_CAPABILITIES, initializeAcpConnection } from './capabilities-cache.js';
import type { AcpParsedCapabilities } from '../types.js';
import type { AgentSessionCallbacks, AgentSessionOptions } from '../../agent/types.js';
import { type Logger, noopLogger } from '../../logger.js';
import { TerminalManager } from '../protocol/terminal-manager.js';

const PERSISTENT_CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PersistentConnection {
  connection: ClientSideConnection;
  child: ChildProcess;
  transport: ProcessStreamTransport;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
  sessions: Map<string, { sessionId: string; createdAt: number }>;
  debugLog: AcpDebugLog;
  capabilities: AcpParsedCapabilities;
  terminalManager: TerminalManager;
}

export interface ActiveSession {
  acpSessionId: string;
  localSessionId: string;
  options: AgentSessionOptions;
  callbacks: AgentSessionCallbacks;
}

export class PersistentAgentConnectionManager {
  private connections = new Map<string, PersistentConnection>();
  private activeSessions = new Map<string, ActiveSession>(); // key: acpSessionId
  private terminalToSession = new Map<string, string>(); // key: terminalId, value: acpSessionId

  constructor(
    private store: ProviderStore,
    private fetcher: RegistryFetcher,
    private launcher: ProviderLauncher,
    private logger: Logger = noopLogger,
  ) {}

  registerActiveSession(acpSessionId: string, session: ActiveSession, providerId?: string) {
    this.activeSessions.set(acpSessionId, session);
    if (providerId) {
      const conn = this.connections.get(providerId);
      if (conn) {
        conn.sessions.set(acpSessionId, { sessionId: acpSessionId, createdAt: Date.now() });
      }
    } else {
      for (const conn of this.connections.values()) {
        conn.sessions.set(acpSessionId, { sessionId: acpSessionId, createdAt: Date.now() });
      }
    }
  }

  unregisterActiveSession(acpSessionId: string) {
    this.activeSessions.delete(acpSessionId);
    for (const conn of this.connections.values()) {
      conn.sessions.delete(acpSessionId);
    }
    for (const [termId, sessId] of Array.from(this.terminalToSession.entries())) {
      if (sessId === acpSessionId) {
        this.terminalToSession.delete(termId);
        for (const conn of this.connections.values()) {
          conn.terminalManager.release(termId);
        }
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
    return this.store.listAll().find((p) => p.id === command || p.command === command)?.id;
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

    const launch = this.launcher.resolveLaunch(provider, agent);
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
    const stream = wrapDebug(rawStream, (direction, message) => {
      debugLog.recordLine(direction === 'send' ? 'outgoing' : 'incoming', JSON.stringify(message));
      if (process.env.AGENTCTL_ACP_DEBUG === '1') {
        this.logger.debug(
          formatAcpMessageLog(direction === 'send' ? 'send' : 'recv', message),
          'ACP Frame',
        );
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      debugLog.recordLine('stderr', data.toString());
    });

    const terminalManager = new TerminalManager(this.logger);

    const connection = new ClientSideConnection(() => {
      const handlers = createClientHandlers({
        // Per-request session resolution overrides this default; only used
        // by handlers that never resolve a session (none today).
        cwd: process.cwd(),
        terminalManager,
        logger,
        mcpGateway: undefined,
        resolveSession: (params?: { sessionId?: string }) => {
          const acpSessionId = params?.sessionId;
          if (!acpSessionId) {
            throw new Error('Missing sessionId in request');
          }
          const session = activeSessions.get(acpSessionId);
          if (!session) {
            throw new Error(`Session ${acpSessionId} not found or inactive`);
          }
          return {
            callbacks: session.callbacks,
            cwd: session.options.cwd,
            additionalDirectories: session.options.additionalDirectories,
            onTerminalCreated: (terminalId) => {
              terminalToSession.set(terminalId, session.acpSessionId);
            },
          };
        },
      });
      return handlers;
    }, stream);

    terminalManager.on('output', (event) => {
      const { terminalId, data } = event as { terminalId: string; data: string };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const session = activeSessions.get(acpSessionId);
        if (session) {
          void session.callbacks.onUpdate({ type: 'terminal_output', terminalId, data });
        }
      }
    });

    terminalManager.on('exit', (event) => {
      const { terminalId, code } = event as { terminalId: string; code: number | null };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const session = activeSessions.get(acpSessionId);
        if (session) {
          void session.callbacks.onUpdate({ type: 'terminal_exit', terminalId, code });
        }
      }
    });

    const acpInitRes = await initializeAcpConnection(connection, {
      transport,
      timeoutMs: 120_000,
      clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
    });
    const parsedCapabilities = acpInitRes.parsedCapabilities;

    const persistentConn: PersistentConnection = {
      connection,
      child,
      transport,
      lastUsed: Date.now(),
      idleTimer: null,
      sessions: new Map(),
      debugLog,
      capabilities: parsedCapabilities,
      terminalManager,
    };

    this.connections.set(providerId, persistentConn);
    this.resetIdleTimer(persistentConn);

    child.once('exit', (code, signal) => {
      logger.info(
        { providerId, code, signal },
        `Persistent agent process exited for provider ${providerId}`,
      );

      const exitReason = String(code ?? signal ?? 'unknown');
      const sessionsToNotify: ActiveSession[] = [];
      for (const [acpSessionId, session] of this.activeSessions.entries()) {
        if (persistentConn.sessions.has(acpSessionId) || persistentConn.sessions.size === 0) {
          sessionsToNotify.push(session);
        }
      }

      for (const session of sessionsToNotify) {
        void (async () => {
          try {
            await session.callbacks.onUpdate({
              type: 'status',
              status: 'error',
              title: `Agent process exited with code ${exitReason}`,
            });
          } catch (err) {
            logger.warn(
              { err, acpSessionId: session.acpSessionId },
              'Failed to emit exit status event for session',
            );
          }
        })();
        this.unregisterActiveSession(session.acpSessionId);
      }

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

    if (conn.capabilities.supportsCloseSession) {
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
