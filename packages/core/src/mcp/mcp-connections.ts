import type { Logger } from '../logger.js';
import type { McpConnection, McpConnectionFactory, McpServerConfig } from './mcp-connection.js';

interface Lease {
  id: string;
  connection: McpConnection;
  epoch: number;
  closed: boolean;
  closing?: Promise<void>;
}

/** Owns persistent and temporary connections, including handshakes still in flight. */
export class McpConnections {
  private epoch = 0;
  private stopped = false;
  private readonly active = new Map<string, Lease>();
  private readonly owned = new Set<Lease>();
  private readonly opening = new Set<Promise<Lease>>();
  private readonly requests = new Set<Promise<unknown>>();
  private readonly errors = new Map<string, string>();
  private stopping?: Promise<void>;

  constructor(
    private readonly create: McpConnectionFactory,
    private readonly logger: Logger,
  ) {}

  resume(): void {
    this.stopped = false;
  }
  entries(): Array<[string, McpConnection]> {
    return [...this.active].map(([id, lease]) => [id, lease.connection]);
  }
  get(id: string): McpConnection | undefined {
    return this.active.get(id)?.connection;
  }
  error(id: string): string | undefined {
    return this.errors.get(id);
  }
  assertRunning(): void {
    if (this.stopped) throw new Error('MCP Gateway is stopped');
  }

  open(server: McpServerConfig, persistent: boolean): Promise<Lease> {
    const operation = this.connect(server, persistent);
    this.opening.add(operation);
    const done = () => this.opening.delete(operation);
    void operation.then(done, done);
    return operation;
  }

  private async connect(server: McpServerConfig, persistent: boolean): Promise<Lease> {
    this.assertRunning();
    const epoch = this.epoch;
    this.errors.delete(server.id);
    let lease: Lease | undefined;
    try {
      const connection = this.create(server);
      lease = { id: server.id, connection, epoch, closed: false };
      const owned = lease;
      this.owned.add(owned);
      connection.onclose = () => {
        owned.closed = true;
        if (this.active.get(server.id) === owned) this.active.delete(server.id);
        // A pending handshake is retained until its connect promise settles.
        if (owned.closing) return;
        this.owned.delete(owned);
      };
      connection.onerror = (error) => {
        if (this.current(owned)) this.errors.set(server.id, error.message);
      };
      await connection.connect();
      if (!this.current(owned)) throw new Error('MCP connection closed during startup');
      if (persistent) this.active.set(server.id, owned);
      return owned;
    } catch (error) {
      if (!this.stopped && epoch === this.epoch)
        this.errors.set(server.id, error instanceof Error ? error.message : String(error));
      if (lease) await this.close(lease);
      throw error;
    }
  }

  private current(lease: Lease): boolean {
    return !this.stopped && !lease.closed && lease.epoch === this.epoch;
  }

  async run<T>(
    connection: McpConnection,
    operation: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    this.assertRunning();
    const lease = [...this.owned].find((entry) => entry.connection === connection);
    if (!lease || !this.current(lease)) throw new Error('MCP connection is no longer active');
    const request = Promise.resolve().then(() => {
      if (!this.current(lease)) throw new Error('MCP Gateway is stopped');
      return operation(connection);
    });
    this.requests.add(request);
    try {
      const result = await request;
      if (!this.current(lease)) throw new Error('MCP Gateway is stopped');
      return result;
    } finally {
      this.requests.delete(request);
    }
  }

  async temporary<T>(
    server: McpServerConfig,
    operation: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    const lease = await this.open(server, false);
    try {
      if (!this.current(lease)) throw new Error('MCP Gateway is stopped');
      return await this.run(lease.connection, operation);
    } finally {
      await this.close(lease);
    }
  }

  private close(lease: Lease): Promise<void> {
    if (lease.closing) return lease.closing;
    lease.closed = true;
    if (this.active.get(lease.id) === lease) this.active.delete(lease.id);
    lease.closing = Promise.resolve()
      .then(() => lease.connection.close())
      .catch((error) => {
        this.logger.error(error, `Failed to close MCP server ${lease.id}`);
      })
      .finally(() => {
        this.owned.delete(lease);
      });
    return lease.closing;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.epoch += 1;
    this.active.clear();
    this.errors.clear();
    const stopping = Promise.allSettled([...this.owned].map((lease) => this.close(lease)))
      .then(async () => {
        await Promise.allSettled(this.opening);
        await Promise.allSettled(this.requests);
      })
      .finally(() => {
        if (this.stopping === stopping) this.stopping = undefined;
      });
    this.stopping = stopping;
    return stopping;
  }
}
