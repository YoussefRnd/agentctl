import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { ProviderLauncher } from '../../providers/registry/provider-launcher.js';
import type { ProviderStore } from '../../providers/registry/provider-store.js';
import type { RegistryFetcher } from '../../providers/registry/registry-fetcher.js';
import { parseRegistryAgents } from '../../providers/registry/registry-parser.js';
import { ProcessStreamTransport, cleanEnv } from './process-transport.js';
import { createClientHandlers } from '../protocol/client-handlers.js';
import { AcpDebugLog, wrapDebug, formatAcpMessageLog } from './stream-debug.js';
import { AGENTCTL_CLIENT_CAPABILITIES, initializeAcpConnection } from './capabilities-cache.js';
import type { AcpParsedCapabilities } from '../types.js';
import type { AgentSessionCallbacks, AgentSessionOptions } from '../../agent/types.js';
import { type Logger, noopLogger } from '../../logger.js';
import { TerminalManager } from '../protocol/terminal-manager.js';
import type {
  AgentConnectionDiagnostic,
  AgentDiagnosticsRecorder,
} from '../../agent/diagnostics.js';
import type { AgentFeatures } from '../../agent/types.js';

const PERSISTENT_CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PersistentConnection {
  providerId: string;
  generation: number;
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
  private pendingConnections = new Map<string, Promise<PersistentConnection>>();
  private providerEpochs = new Map<string, number>();
  private activeSessions = new Map<string, ActiveSession>(); // key: acpSessionId
  private terminalToSession = new Map<string, string>(); // key: terminalId, value: acpSessionId
  private nextGeneration = 1;

  constructor(
    private store: ProviderStore,
    private fetcher: RegistryFetcher,
    private launcher: ProviderLauncher,
    private logger: Logger = noopLogger,
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {}

  registerActiveSession(acpSessionId: string, session: ActiveSession, providerId: string) {
    this.activeSessions.set(acpSessionId, session);
    const conn = this.connections.get(providerId);
    if (conn) {
      conn.sessions.set(acpSessionId, { sessionId: acpSessionId, createdAt: Date.now() });
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
    if (conn?.transport.isAlive) {
      conn.lastUsed = Date.now();
      this.resetIdleTimer(conn);
      this.diagnostics?.record({
        kind: 'connection_reused',
        adapter: 'acp-v1',
        providerId,
        generation: conn.generation,
        path: 'persistent',
      });
      return conn;
    }

    const pending = this.pendingConnections.get(providerId);
    if (pending) return pending;

    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const snapshot = this.fetcher.getSnapshot();
    const agents = snapshot ? parseRegistryAgents(snapshot.data) : [];
    const agent = agents.find((a) => a.id === providerId);
    if (!agent) throw new Error(`Registry agent data not found for ${providerId}`);

    const launch = this.launcher.resolveLaunch(provider, agent);
    const epoch = this.providerEpochs.get(providerId) ?? 0;
    const creation = this.createPersistentConnection(providerId, launch, epoch);
    this.pendingConnections.set(providerId, creation);
    try {
      return await creation;
    } finally {
      if (this.pendingConnections.get(providerId) === creation) {
        this.pendingConnections.delete(providerId);
      }
    }
  }

  private async createPersistentConnection(
    providerId: string,
    launch: { command: string; args: string[]; env: Record<string, string> },
    epoch: number,
  ): Promise<PersistentConnection> {
    const generation = this.nextGeneration++;
    this.diagnostics?.record({
      kind: 'connection_starting',
      adapter: 'acp-v1',
      providerId,
      generation,
      path: 'persistent',
    });
    const activeSessions = this.activeSessions;
    const terminalToSession = this.terminalToSession;
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
        logger: this.logger,
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

    let acpInitRes;
    try {
      acpInitRes = await initializeAcpConnection(connection, {
        transport,
        timeoutMs: 120_000,
        clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
      });
    } catch (error) {
      transport.kill();
      await terminalManager.dispose();
      throw error;
    }
    const parsedCapabilities = acpInitRes.parsedCapabilities;

    const persistentConn: PersistentConnection = {
      providerId,
      generation,
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

    if ((this.providerEpochs.get(providerId) ?? 0) !== epoch) {
      this.closeConnectionByInstance(persistentConn);
      throw new Error(`Connection creation for ${providerId} was cancelled`);
    }

    this.connections.set(providerId, persistentConn);
    this.resetIdleTimer(persistentConn);
    this.diagnostics?.record({
      kind: 'connection_ready',
      adapter: 'acp-v1',
      providerId,
      generation,
      path: 'persistent',
      features: this.featuresFromCapabilities(parsedCapabilities),
    });

    child.once('exit', (code, signal) => {
      this.handleConnectionExit(providerId, persistentConn, code, signal);
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
        this.diagnostics?.record({
          kind: 'connection_closed',
          adapter: 'acp-v1',
          providerId: conn.providerId,
          generation: conn.generation,
          path: 'persistent',
          reason: 'idle_timeout',
        });
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
    this.providerEpochs.set(providerId, (this.providerEpochs.get(providerId) ?? 0) + 1);
    const conn = this.connections.get(providerId);
    if (conn) {
      this.diagnostics?.record({
        kind: 'connection_closed',
        adapter: 'acp-v1',
        providerId,
        generation: conn.generation,
        path: 'persistent',
        reason: 'provider_closed',
      });
      this.closeConnectionByInstance(conn);
      this.connections.delete(providerId);
    }
  }

  private closeConnectionIfCurrent(providerId: string, connection: PersistentConnection) {
    if (this.connections.get(providerId) !== connection) return;
    this.closeConnectionByInstance(connection);
    this.connections.delete(providerId);
  }

  private handleConnectionExit(
    providerId: string,
    connection: PersistentConnection,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    this.logger.info(
      { providerId, generation: connection.generation, code, signal },
      `Persistent agent process exited for provider ${providerId}`,
    );
    this.diagnostics?.record({
      kind: 'connection_exited',
      adapter: 'acp-v1',
      providerId,
      generation: connection.generation,
      path: 'persistent',
      reason: 'process_exit',
    });

    const exitReason = String(code ?? signal ?? 'unknown');
    const sessionsToNotify = Array.from(connection.sessions.keys())
      .map((sessionId) => this.activeSessions.get(sessionId))
      .filter((session): session is ActiveSession => session !== undefined);

    for (const session of sessionsToNotify) {
      void Promise.resolve(
        session.callbacks.onUpdate({
          type: 'status',
          status: 'error',
          title: `Agent process exited with code ${exitReason}`,
        }),
      ).catch((err: unknown) => {
        this.logger.warn(
          { err, acpSessionId: session.acpSessionId },
          'Failed to emit exit status event for session',
        );
      });
      this.unregisterActiveSession(session.acpSessionId);
    }

    this.closeConnectionIfCurrent(providerId, connection);
  }

  private closeConnectionByInstance(conn: PersistentConnection) {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
      conn.idleTimer = null;
    }
    void conn.terminalManager.dispose();
    conn.transport.kill();
  }

  getConnectionDiagnostics(): AgentConnectionDiagnostic[] {
    return Array.from(this.connections.values()).map((connection) => ({
      adapter: 'acp-v1',
      providerId: connection.providerId,
      generation: connection.generation,
      state: 'ready',
      activeSessionCount: connection.sessions.size,
      lastUsedAt: new Date(connection.lastUsed).toISOString(),
      features: this.featuresFromCapabilities(connection.capabilities),
    }));
  }

  private featuresFromCapabilities(capabilities: AcpParsedCapabilities): AgentFeatures {
    return {
      sessions: {
        resume: capabilities.supportsResumeSession || capabilities.supportsLoadSession,
        fork: capabilities.supportsForkSession,
        delete: capabilities.supportsDeleteSession,
        list: capabilities.supportsListSessions,
      },
      prompts: {
        image: capabilities.supportsImage,
        audio: capabilities.supportsAudio,
        embeddedContext: capabilities.supportsEmbeddedContext,
      },
      configuration: { model: false, options: false },
      authentication: { logout: false },
    };
  }

  closeAll() {
    for (const providerId of this.connections.keys()) {
      this.closeConnection(providerId);
    }
  }
}
