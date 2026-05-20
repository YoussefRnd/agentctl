import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import type { ACPConfigOption, AuthMethod, DriverDiscovery, RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';
import { notFoundEntry, probeAgent } from './acp-probe.js';
import { drivers } from '../db/schema.js';
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

const CLAUDE_ACP_FALLBACK: DriverDiscovery = {
  id: 'claude-acp',
  label: 'Claude Agent',
  status: 'inactive',
  command: 'npx',
  launchArgs: ['-y', '@agentclientprotocol/claude-agent-acp@0.36.1'],
  launchEnv: {},
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: 'claude-3-7-sonnet-latest',
      options: [
        { value: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet (Latest)' },
        { value: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet (Latest)' },
        { value: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (20241022)' },
        { value: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku (Latest)' },
        { value: 'claude-3-opus-latest', name: 'Claude 3 Opus (Latest)' },
      ],
    },
  ],
  authMethods: [
    {
      id: 'env_api_key',
      name: 'Configure ANTHROPIC_API_KEY',
      description: 'Ensure the ANTHROPIC_API_KEY environment variable is set.',
    },
  ],
  version: '0.36.1',
  description: "ACP wrapper for Anthropic's Claude",
  icon: 'https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg',
};

const CODEX_ACP_FALLBACK: DriverDiscovery = {
  id: 'codex-acp',
  label: 'Codex CLI',
  status: 'inactive',
  command: 'npx',
  launchArgs: ['-y', '@zed-industries/codex-acp@0.14.0'],
  launchEnv: {},
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: 'gpt-4o',
      options: [
        { value: 'gpt-4o', name: 'GPT-4o' },
        { value: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { value: 'o3-mini', name: 'o3-mini' },
        { value: 'o1', name: 'o1' },
        { value: 'o1-preview', name: 'o1 Preview' },
        { value: 'o1-mini', name: 'o1 Mini' },
      ],
    },
  ],
  authMethods: [
    {
      id: 'env_api_key',
      name: 'Configure OPENAI_API_KEY',
      description: 'Ensure the OPENAI_API_KEY environment variable is set.',
    },
  ],
  version: '0.14.0',
  description: "ACP adapter for OpenAI's coding assistant",
  icon: 'https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg',
};

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

async function fetchRegistry(logger: Logger): Promise<RegistryAgent[]> {
  try {
    const response = await fetch(REGISTRY_URL);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ACP registry: ${String(response.status)} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { agents: RegistryAgent[] };
    return data.agents;
  } catch (err) {
    logger.warn(err, 'Failed to fetch remote registry');
    return [];
  }
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

  async sync(): Promise<void> {
    this.logger.info('Starting agent discovery and sync...');
    const registryAgents = await fetchRegistry(this.logger);
    const supportedRegistry = registryAgents.filter((a) => SUPPORTED_AGENTS.has(a.id));

    const discovered: DriverDiscovery[] = [];

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

    // 2. Process registry agents sequentially (only those not already found locally)
    const registryResults: DriverDiscovery[] = [];
    for (const agent of supportedRegistry) {
      if (discovered.some((r) => r.id === agent.id)) {
        continue;
      }

      const existingDriver = await this.getDriver(agent.id);

      let fallback: DriverDiscovery | null = null;
      if (agent.id === 'claude-acp') {
        fallback = { ...CLAUDE_ACP_FALLBACK };
      } else if (agent.id === 'codex-acp') {
        fallback = { ...CODEX_ACP_FALLBACK };
      }

      // If it's an NPX agent (has a fallback), skip the automatic 60s probe to avoid hangs.
      if (fallback) {
        if (existingDriver?.status === 'ready') {
          fallback.status = 'ready';
        }
        registryResults.push(fallback);
        continue;
      }

      const launch = resolveLaunchConfig(agent);
      if (!launch) {
        registryResults.push(notFoundEntry(agent));
        continue;
      }

      this.logger.info(`Probing registry agent: ${agent.id}...`);
      const probeResult = await probeAgent(agent, launch, this.logger);
      registryResults.push(probeResult);
    }
    discovered.push(...registryResults);

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
