import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { eq, desc } from 'drizzle-orm';
import type { ACPConfigOption, AuthMethod, DriverDiscovery, RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';
import { notFoundEntry, probeAgent } from './acp-probe.js';
import { drivers, registrySnapshots } from '../db/schema.js';
import type { DbClient } from './acp-session.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const SUPPORTED_AGENTS = new Set([
  'opencode',
  'claude-acp',
  'codex-acp',
  'gemini-acp',
]);

const LOCAL_BINARY_HINTS = [
  { id: 'opencode', command: 'opencode', args: ['acp'], label: 'OpenCode (Local)' },
];

function isBinaryOnPath(command: string): boolean {
  try {
    const checkCmd = os.platform() === 'win32' ? `where ${command}` : `which ${command}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getPlatformKey(): string {
  const arch = os.arch();
  const platform = os.platform();

  const archMap: Record<string, string> = {
    x64: 'x86_64',
    arm64: 'aarch64',
    aarch64: 'aarch64',
  };

  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };

  const normalizedArch = archMap[arch] ?? arch;
  const normalizedPlatform = platformMap[platform] ?? platform;

  return `${normalizedPlatform}-${normalizedArch}`;
}

function resolveLaunchConfig(
  agent: RegistryAgent,
): { command: string; args: string[]; env: Record<string, string> } | null {
  const platform = getPlatformKey();

  const binaryTarget = agent.distribution.binary?.[platform];
  if (binaryTarget) {
    let command = binaryTarget.cmd;
    let exists = false;
    if (command.startsWith('./')) {
      if (fs.existsSync(command)) {
        exists = true;
      } else {
        const pathCmd = command.substring(2);
        if (isBinaryOnPath(pathCmd)) {
          command = pathCmd;
          exists = true;
        }
      }
    } else {
      exists = isBinaryOnPath(command);
    }

    if (exists) {
      return {
        command,
        args: [...binaryTarget.args],
        env: binaryTarget.env,
      };
    }
  }

  if (agent.distribution.npx) {
    const { package: pkg, args, env } = agent.distribution.npx;
    return {
      command: 'npx',
      args: ['-y', pkg, ...args],
      env,
    };
  }

  if (agent.distribution.uvx) {
    const { package: pkg, args, env } = agent.distribution.uvx;
    return {
      command: 'uvx',
      args: [pkg, ...args],
      env,
    };
  }

  return null;
}

export class DriverRegistry {
  constructor(
    private db: DbClient,
    private logger: Logger = noopLogger,
  ) {}

  async discover(): Promise<DriverDiscovery[]> {
    const rows = await this.db.select().from(drivers);

    if (rows.length === 0) {
      this.logger.info('Registry is empty, performing initial sync...');
      await this.sync();
      return this.discover();
    }

    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      status: row.status,
      command: row.command,
      launchArgs: JSON.parse(row.launchArgs) as string[],
      launchEnv: JSON.parse(row.launchEnv) as Record<string, string>,
      configOptions: JSON.parse(row.configOptions) as ACPConfigOption[],
      authMethods: JSON.parse(row.authMethods) as AuthMethod[],
      version: row.version ?? undefined,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
    }));
  }

  private async fetchRegistryWithCache(): Promise<{ agents: RegistryAgent[]; source: 'remote' | 'cache' }> {
    const snapshots = await this.db
      .select()
      .from(registrySnapshots)
      .orderBy(desc(registrySnapshots.fetchedAt))
      .limit(1);
    const lastSnapshot = snapshots[0] as typeof registrySnapshots.$inferSelect | undefined;

    const headers: Record<string, string> = {};
    if (lastSnapshot?.etag) headers['If-None-Match'] = lastSnapshot.etag;
    if (lastSnapshot?.lastModified) headers['If-Modified-Since'] = lastSnapshot.lastModified;

    try {
      const response = await fetch(REGISTRY_URL, { headers });

      if (response.status === 304 && lastSnapshot) {
        this.logger.info('Registry unchanged (304), using cached snapshot');
        return { agents: (JSON.parse(lastSnapshot.data) as { agents: RegistryAgent[] }).agents, source: 'cache' };
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${String(response.status)} ${response.statusText}`);
      }

      const data = await response.json() as { agents: RegistryAgent[] };
      const etag = response.headers.get('etag');
      const lastModified = response.headers.get('last-modified');

      await this.db.insert(registrySnapshots).values({
        data: JSON.stringify(data),
        etag,
        lastModified,
        fetchedAt: new Date(),
      });

      return { agents: data.agents, source: 'remote' };
    } catch (err) {
      this.logger.warn(err, 'Failed to fetch remote registry, falling back to cache');
      if (lastSnapshot) {
        return { agents: (JSON.parse(lastSnapshot.data) as { agents: RegistryAgent[] }).agents, source: 'cache' };
      }
      return { agents: [], source: 'cache' };
    }
  }

  async sync(): Promise<void> {
    this.logger.info('Starting agent discovery and sync...');
    const { agents: registryAgents } = await this.fetchRegistryWithCache();
    const supportedRegistry = registryAgents.filter((a) => SUPPORTED_AGENTS.has(a.id));

    const discovered: DriverDiscovery[] = [];
    const existingDrivers = await this.db.select().from(drivers);
    const existingMap = new Map(existingDrivers.map(d => [d.id, d]));

    // 1. Check for local binaries first (faster and more reliable)
    for (const hint of LOCAL_BINARY_HINTS) {
      if (isBinaryOnPath(hint.command)) {
        this.logger.info(`Found local agent binary: ${hint.command}`);
        const probeResult = await probeAgent(
          {
            id: hint.id,
            name: hint.label,
            version: 'local',
            description: 'Local installation',
            authors: [],
            distribution: {},
          },
          { command: hint.command, args: hint.args, env: {} },
          this.logger,
        );
        if (probeResult.status === 'ready' || probeResult.status === 'needs_auth') {
          discovered.push(probeResult);
        }
      }
    }

    // 2. Process registry agents
    for (const agent of supportedRegistry) {
      if (discovered.some((r) => r.id === agent.id)) {
        continue;
      }

      const existing = existingMap.get(agent.id);
      const launch = resolveLaunchConfig(agent);

      if (!launch) {
        discovered.push(notFoundEntry(agent));
        continue;
      }

      // If we have an existing 'ready' driver and it's an NPX/UVX package, 
      // we prefer the cached data to avoid slow probing on every sync.
      const isPackage = Boolean(agent.distribution.npx ?? agent.distribution.uvx);
      if (existing?.status === 'ready' && isPackage) {
         discovered.push({
            id: agent.id,
            label: agent.name,
            status: 'ready',
            command: launch.command,
            launchArgs: launch.args,
            launchEnv: launch.env,
            configOptions: JSON.parse(existing.configOptions) as ACPConfigOption[],
            authMethods: JSON.parse(existing.authMethods) as AuthMethod[],
            version: agent.version,
            description: agent.description,
            icon: agent.icon,
         });
         continue;
      }

      this.logger.info(`Probing registry agent: ${agent.id}...`);
      const probeResult = await probeAgent(agent, launch, this.logger);
      discovered.push(probeResult);
    }

    // 3. Persist to DB
    for (const driver of discovered) {
      await this.db
        .insert(drivers)
        .values({
          id: driver.id,
          name: driver.label,
          status: driver.status,
          command: driver.command,
          launchArgs: JSON.stringify(driver.launchArgs),
          launchEnv: JSON.stringify(driver.launchEnv),
          configOptions: JSON.stringify(driver.configOptions),
          authMethods: JSON.stringify(driver.authMethods),
          version: driver.version,
          description: driver.description,
          icon: driver.icon,
        })
        .onConflictDoUpdate({
          target: drivers.id,
          set: {
            name: driver.label,
            status: driver.status,
            command: driver.command,
            launchArgs: JSON.stringify(driver.launchArgs),
            launchEnv: JSON.stringify(driver.launchEnv),
            configOptions: JSON.stringify(driver.configOptions),
            authMethods: JSON.stringify(driver.authMethods),
            version: driver.version,
            description: driver.description,
            icon: driver.icon,
            updatedAt: new Date(),
          },
        });
    }

    this.logger.info(`Sync complete. Persisted ${String(discovered.length)} drivers.`);
  }

  async getDriver(id: string): Promise<DriverDiscovery | undefined> {
    const rows = await this.db.select().from(drivers).where(eq(drivers.id, id));
    if (rows.length === 0) return undefined;
    const row = rows[0];

    return {
      id: row.id,
      label: row.name,
      status: row.status,
      command: row.command,
      launchArgs: JSON.parse(row.launchArgs) as string[],
      launchEnv: JSON.parse(row.launchEnv) as Record<string, string>,
      configOptions: JSON.parse(row.configOptions) as ACPConfigOption[],
      authMethods: JSON.parse(row.authMethods) as AuthMethod[],
      version: row.version ?? undefined,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
    };
  }

  async login(
    driverId: string,
    methodId: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const driver = await this.getDriver(driverId);
    if (!driver) throw new Error(`Driver ${driverId} not found`);

    const { child, connection } = createAgentConnection(
      driver.command,
      driver.launchArgs,
      driver.launchEnv,
    );

    try {
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'agentctl-login', version: '1.0.0' },
      });

      await (connection.authenticate({
        methodId,
        _meta: params,
      }) as Promise<unknown>);

      // Update status in DB to ready after successful login
      await this.db
        .update(drivers)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(drivers.id, driverId));
    } finally {
      child.kill();
    }
  }

  async activate(driverId: string): Promise<DriverDiscovery> {
    const driver = await this.getDriver(driverId);
    if (!driver) throw new Error(`Driver ${driverId} not found`);

    if (driver.status === 'inactive' || driver.status === 'not_found') {
      await this.db
        .update(drivers)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(drivers.id, driverId));

      const updated = await this.getDriver(driverId);
      if (!updated) throw new Error('Driver failed to activate or was deleted');
      return updated;
    }
    return driver;
  }
}
