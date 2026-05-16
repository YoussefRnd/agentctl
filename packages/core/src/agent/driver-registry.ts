import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { DriverDiscovery, ACPConfigOption, RegistryAgent } from '@agentctl/shared';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const SUPPORTED_AGENTS = new Set(['opencode', 'claude-code', 'gemini-cli', 'codex-acp']);

const AGENT_BINARY: Record<string, string> = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'opencode': 'opencode',
  'codex-acp': 'codex',
};

function isBinaryOnPath(binary: string): boolean {
  try {
    execSync(`command -v ${binary}`, { stdio: 'ignore' });
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

function resolveLaunchConfig(agent: RegistryAgent): { command: string; args: string[]; env: Record<string, string> } | null {
  const binary = AGENT_BINARY[agent.id];
  if (!binary || !isBinaryOnPath(binary)) return null;

  const platform = getPlatformKey();

  // Prefer ACP flags from the registry binary entry for this platform
  const binaryTarget = agent.distribution.binary?.[platform];
  if (binaryTarget) {
    return {
      command: binary,
      args: [...binaryTarget.args],
      env: binaryTarget.env,
    };
  }

  // Fallback: use --acp flag (works for most agents)
  return {
    command: binary,
    args: ['--acp'],
    env: {},
  };
}

async function fetchRegistry(): Promise<RegistryAgent[]> {
  try {
    const response = await fetch(REGISTRY_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch ACP registry: ${String(response.status)} ${response.statusText}`);
    }

    const data = (await response.json()) as { agents: RegistryAgent[] };
    return data.agents;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch remote registry:', err);
    return [];
  }
}

function notFoundEntry(agent: RegistryAgent): DriverDiscovery {
  return {
    id: agent.id,
    label: agent.name,
    status: 'not_found',
    command: AGENT_BINARY[agent.id] ?? agent.id,
    launchArgs: [],
    launchEnv: {},
    version: agent.version,
    description: agent.description,
    icon: agent.icon,
  };
}

async function probeAgent(
  agent: RegistryAgent,
  launch: { command: string; args: string[]; env: Record<string, string> }
): Promise<DriverDiscovery> {
  const child = spawn(launch.command, launch.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...launch.env },
  });

  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn(`Spawning agent ${agent.id} failed:`, err.message);
  });

  const stdin = child.stdin;
  const stdout = child.stdout;

  const stream = ndJsonStream(
    Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(stdout) as ReadableStream<Uint8Array>
  );

  const connection = new ClientSideConnection(() => ({
    sessionUpdate() { return Promise.resolve(); },
    requestPermission() {
      return Promise.resolve({ outcome: { outcome: 'selected' as const, optionId: 'allow-once' } });
    },
  }), stream);

  try {
    const result = await Promise.race([
      (async () => {
        await connection.initialize({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
        });

        const sessionResult = await connection.newSession({
          cwd: process.cwd(),
          mcpServers: [],
        });

        const configOptions = sessionResult.configOptions as ACPConfigOption[] | undefined;

        return {
          id: agent.id,
          label: agent.name,
          status: 'ready' as const,
          command: launch.command,
          launchArgs: launch.args,
          launchEnv: launch.env,
          configOptions: configOptions ?? [],
          version: agent.version,
          description: agent.description,
          icon: agent.icon,
        };
      })(),
      new Promise<DriverDiscovery>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Probe for ${agent.id} timed out`));
        }, 15_000);
      }),
    ]);

    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Probe failed for ${agent.id}:`, err);
    return notFoundEntry(agent);
  } finally {
    child.kill();
  }
}

export class DriverRegistry {
  private cachedDrivers: DriverDiscovery[] | null = null;
  private lastFetchTime = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

  async discover(): Promise<DriverDiscovery[]> {
    const now = Date.now();
    if (!this.cachedDrivers || now - this.lastFetchTime > DriverRegistry.CACHE_TTL) {
      const registryAgents = await fetchRegistry();

      const agents = registryAgents.filter((agent) => SUPPORTED_AGENTS.has(agent.id));

      this.cachedDrivers = await Promise.all(
        agents.map(async (agent) => {
          const launch = resolveLaunchConfig(agent);
          if (!launch) return notFoundEntry(agent);
          return probeAgent(agent, launch);
        })
      );

      this.lastFetchTime = now;
    }
    return this.cachedDrivers;
  }

  async getDriver(id: string): Promise<DriverDiscovery | undefined> {
    const drivers = await this.discover();
    return drivers.find((d) => d.id === id);
  }
}
