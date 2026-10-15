import { ndJsonStream } from '@agentclientprotocol/sdk';
import type { RegistryAgent } from '@agentctl/shared';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import type {
  AgentConnectionDiagnostic,
  AgentDiagnosticsRecorder,
} from '../../agent/diagnostics.js';
import type {
  AgentFeatures,
  AgentSessionCallbacks,
  AgentSessionOptions,
} from '../../agent/types.js';
import { DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS } from '../../config/runtime-defaults.js';
import { noopLogger, type Logger } from '../../logger.js';
import { Provider } from '../../providers/provider.js';
import type { ProviderLauncher } from '../../providers/registry/provider-launcher.js';
import type { ProviderStore } from '../../providers/registry/provider-store.js';
import type { RegistryFetcher } from '../../providers/registry/registry-fetcher.js';
import { parseRegistryAgents } from '../../providers/registry/registry-parser.js';
import { TerminalManager } from '../protocol/terminal-manager.js';
import type { AcpParsedCapabilities } from '../types.js';
import { AGENTCTL_CLIENT_CAPABILITIES, initializeAcpConnection } from '../v1/capabilities.js';
import { connectAcpClient, type AcpAgentConnection } from './client-connection.js';
import { ProcessStreamTransport, cleanEnv } from './process-transport.js';
import { observeAcpStderr } from './stderr.js';
import { AcpDebugLog, formatAcpMessageLog, wrapDebug } from './stream-debug.js';

import type { AgentMcpGateway } from '../../agent/types.js';
import { ACP_PROCESS_OPTIONS, ownAcpProcess, withTimeout } from './acp-process-lifecycle.js';
import { matchesConnectionLease, type AcpConnectionLease } from './connection-lease.js';
import { ACP_SESSION_CLOSE_TIMEOUT_MS } from './limits.js';

const PERSISTENT_CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface PersistentConnection {
  mcpGateway?: AgentMcpGateway;
  providerId: string;
  generation: number;
  connection: AcpAgentConnection;
  child: ChildProcess;
  transport: ProcessStreamTransport;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
  sessions: Map<string, { sessionId: string; createdAt: number }>;
  activeSessions: Map<string, ActiveSession>;
  terminalToSession: Map<string, string>;
  terminalCallbacks?: Map<string, AgentSessionCallbacks>;
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
  private pendingTransports = new Map<string, ProcessStreamTransport>();
  private providerEpochs = new Map<string, number>();
  private nextGeneration = 1;

  constructor(
    private store: ProviderStore,
    private fetcher: RegistryFetcher,
    private launcher: ProviderLauncher,
    private logger: Logger = noopLogger,
    private diagnostics?: AgentDiagnosticsRecorder,
  ) {}

  registerActiveSession(
    acpSessionId: string,
    session: ActiveSession,
    providerId: string,
    lease: AcpConnectionLease,
  ) {
    const conn = this.connections.get(providerId);
    if (!matchesConnectionLease(conn, lease) || !conn?.transport.isAlive)
      throw new Error('ACP connection lease is no longer active');
    if (conn) {
      conn.activeSessions.set(acpSessionId, session);
      conn.sessions.set(acpSessionId, { sessionId: acpSessionId, createdAt: Date.now() });
    }
  }

  unregisterActiveSession(acpSessionId: string, providerId: string, lease: AcpConnectionLease) {
    const conn = this.connections.get(providerId);
    if (conn && matchesConnectionLease(conn, lease))
      this.unregisterConnectionSession(conn, acpSessionId);
  }

  private unregisterConnectionSession(conn: PersistentConnection, acpSessionId: string) {
    conn.connection?.releaseSessionContext?.(acpSessionId);
    conn.activeSessions.delete(acpSessionId);
    conn.sessions.delete(acpSessionId);
    for (const [termId, sessId] of conn.terminalToSession) {
      if (sessId === acpSessionId) {
        conn.terminalToSession.delete(termId);
        conn.terminalCallbacks?.delete(termId);
        conn.terminalManager.release(termId);
      }
    }
  }

  writeTerminalInput(
    terminalId: string,
    data: string,
    lease: AcpConnectionLease,
    sessionId: string,
  ): boolean {
    for (const conn of this.connections.values()) {
      if (
        !matchesConnectionLease(conn, lease) ||
        conn.terminalToSession.get(terminalId) !== sessionId
      )
        continue;
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

  async getConnection(
    providerId: string,
    options?: { mcpGateway?: AgentMcpGateway },
  ): Promise<PersistentConnection> {
    const conn = this.connections.get(providerId);
    if (conn?.transport.isAlive) {
      if (options?.mcpGateway !== conn.mcpGateway)
        throw new Error('Persistent ACP connection has a different MCP gateway');
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
    if (pending) {
      const connection = await pending;
      if (options?.mcpGateway !== connection.mcpGateway)
        throw new Error('Persistent ACP connection has a different MCP gateway');
      return connection;
    }

    const provider = this.store.get(providerId);
    if (!provider) throw new Error(`Provider ${providerId} not found`);

    const snapshot = this.fetcher.getSnapshot();
    let registryAgent: RegistryAgent | undefined;
    if (snapshot) {
      try {
        registryAgent = parseRegistryAgents(snapshot.data).find(
          (a) => a.id === (this.store.get(providerId)?.registryAgentId ?? providerId),
        );
      } catch (error) {
        this.logger.warn({ error }, 'Ignoring invalid provider registry snapshot for connection');
      }
    }
    const agent = registryAgent ?? new Provider(provider).toDiscovery().agent;
    if (!agent) throw new Error(`Provider launch metadata not found for ${providerId}`);

    const launch = this.launcher.resolveLaunch(provider, agent);
    const epoch = this.providerEpochs.get(providerId) ?? 0;
    const creation = this.createPersistentConnection(
      providerId,
      launch,
      epoch,
      options?.mcpGateway,
    );
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
    mcpGateway?: AgentMcpGateway,
  ): Promise<PersistentConnection> {
    const generation = this.nextGeneration++;
    this.diagnostics?.record({
      kind: 'connection_starting',
      adapter: 'acp-v1',
      providerId,
      generation,
      path: 'persistent',
    });
    const activeSessions = new Map<string, ActiveSession>();
    const terminalToSession = new Map<string, string>();
    const terminalCallbacks = new Map<string, AgentSessionCallbacks>();
    const debugLog = new AcpDebugLog();
    const child = ownAcpProcess(
      spawn(launch.command, launch.args, {
        ...ACP_PROCESS_OPTIONS,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: cleanEnv(launch.env),
        cwd: os.tmpdir(),
      }),
    );

    observeAcpStderr(child, cleanEnv(launch.env));
    const transport = new ProcessStreamTransport(child, this.logger);
    this.pendingTransports.set(providerId, transport);
    const rawStream = ndJsonStream(transport.stdin, transport.stdout);
    const stream = wrapDebug(rawStream, (direction, message) => {
      debugLog.recordLine(
        direction === 'send' ? 'outgoing' : 'incoming',
        JSON.stringify(formatAcpMessageLog(direction, message)),
      );
      if (process.env.AGENTCTL_ACP_DEBUG === '1') {
        this.logger.debug(
          formatAcpMessageLog(direction === 'send' ? 'send' : 'recv', message),
          'ACP Frame',
        );
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      debugLog.recordLine('stderr', JSON.stringify({ bytes: data.byteLength }));
    });

    const terminalManager = new TerminalManager(this.logger);

    const connection = await connectAcpClient(
      {
        // Per-request session resolution overrides this default; only used
        // by handlers that never resolve a session (none today).
        cwd: process.cwd(),
        terminalManager,
        logger: this.logger,
        mcpGateway,
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
            localSessionId: session.localSessionId,
            cwd: session.options.cwd,
            additionalDirectories: session.options.additionalDirectories,
            onTerminalCreated: (terminalId, owner) => {
              terminalToSession.set(terminalId, session.acpSessionId);
              terminalCallbacks.set(terminalId, owner);
            },
          };
        },
      },
      stream,
    ).catch(async (error: unknown) => {
      transport.kill();
      await terminalManager.dispose();
      if (this.pendingTransports.get(providerId) === transport)
        this.pendingTransports.delete(providerId);
      throw error;
    });

    terminalManager.on('output', (event) => {
      const { terminalId, data } = event as { terminalId: string; data: string };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const owner = terminalCallbacks.get(terminalId);
        if (activeSessions.has(acpSessionId) && owner) {
          void owner.onUpdate({ type: 'terminal_output', terminalId, data });
        }
      }
    });

    terminalManager.on('exit', (event) => {
      const { terminalId, code } = event as { terminalId: string; code: number | null };
      const acpSessionId = terminalToSession.get(terminalId);
      if (acpSessionId) {
        const owner = terminalCallbacks.get(terminalId);
        if (activeSessions.has(acpSessionId) && owner) {
          void owner.onUpdate({ type: 'terminal_exit', terminalId, code });
        }
      }
    });

    let acpInitRes;
    try {
      acpInitRes = await initializeAcpConnection(connection, {
        transport,
        timeoutMs: DEFAULT_AGENT_INITIALIZATION_TIMEOUT_MS,
        clientCapabilities: AGENTCTL_CLIENT_CAPABILITIES,
      });
    } catch (error) {
      transport.kill();
      await terminalManager.dispose();
      throw error;
    } finally {
      if (this.pendingTransports.get(providerId) === transport) {
        this.pendingTransports.delete(providerId);
      }
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
      activeSessions,
      terminalToSession,
      terminalCallbacks,
      debugLog,
      capabilities: parsedCapabilities,
      terminalManager,
      mcpGateway,
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

  async closeSession(
    providerId: string,
    acpSessionId: string,
    lease: AcpConnectionLease,
  ): Promise<void> {
    const conn = this.connections.get(providerId);
    if (!conn || !matchesConnectionLease(conn, lease)) return;

    conn.sessions.delete(acpSessionId);
    this.unregisterConnectionSession(conn, acpSessionId);

    if (conn.capabilities.supportsCloseSession) {
      try {
        await withTimeout(
          conn.connection.closeSession({ sessionId: acpSessionId }),
          ACP_SESSION_CLOSE_TIMEOUT_MS,
          'closing persistent ACP session',
        );
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
    const pendingTransport = this.pendingTransports.get(providerId);
    if (pendingTransport) {
      pendingTransport.kill();
      this.pendingTransports.delete(providerId);
    }
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
      .map((sessionId) => connection.activeSessions.get(sessionId))
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
      this.unregisterConnectionSession(connection, session.acpSessionId);
    }

    this.closeConnectionIfCurrent(providerId, connection);
  }

  private closeConnectionByInstance(conn: PersistentConnection) {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
      conn.idleTimer = null;
    }
    void conn.terminalManager.dispose();
    conn.connection.close?.();
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
    const providerIds = new Set([
      ...this.connections.keys(),
      ...this.pendingConnections.keys(),
      ...this.pendingTransports.keys(),
    ]);
    for (const providerId of providerIds) {
      this.closeConnection(providerId);
    }
  }
}
