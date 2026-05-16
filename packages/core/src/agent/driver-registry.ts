import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { DriverDiscovery, ACPConfigOption, RegistryAgent } from '@agentctl/shared';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

/**
 * Built-in fallback agents to ensure common harnesses are always discoverable
 * even if the remote registry is inaccessible or slow.
 */
const BUILTIN_AGENTS: RegistryAgent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    version: 'latest',
    authors: ['Anthropic'],
    description: 'Anthropic\'s official CLI agent for coding tasks.',
    distribution: {
      npx: {
        package: '@anthropic-ai/claude-code',
        args: ['--acp'],
        env: {},
      }
    }
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    version: 'latest',
    authors: ['Google'],
    description: 'Google\'s official CLI agent for coding tasks.',
    distribution: {
      npx: {
        package: '@google/gemini-cli',
        args: ['--acp'],
        env: {},
      }
    }
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    version: 'latest',
    authors: ['OpenSource'],
    description: 'Open-source coding agent with ACP support.',
    distribution: {
      npx: {
        package: 'opencode',
        args: ['--acp'],
        env: {},
      }
    }
  }
];

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

function getNpxRunner(): string {
  try {
    execSync('command -v npx', { stdio: 'ignore' });
    return 'npx';
  } catch {
    return '';
  }
}

function getUvxRunner(): string {
  try {
    execSync('command -v uvx', { stdio: 'ignore' });
    return 'uvx';
  } catch {
    return '';
  }
}

interface LaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function resolveLaunchConfig(agent: RegistryAgent): LaunchConfig | null {
  const platform = getPlatformKey();
  const dist = agent.distribution;

  // Try npx first (zero-install, works if npx is available)
  if (dist.npx) {
    const npx = getNpxRunner();
    if (npx) {
      const packageArgs = Array.isArray(dist.npx.args) ? dist.npx.args : [];
      return {
        command: npx,
        // CRITICAL: use --yes to avoid interactive prompts
        args: ['--yes', dist.npx.package, ...packageArgs],
        env: dist.npx.env,
      };
    }
  }

  // Try binary for current platform
  const binaryTarget = dist.binary?.[platform];
  if (binaryTarget) {
    const binaryArgs = Array.isArray(binaryTarget.args) ? binaryTarget.args : [];
    return {
      command: binaryTarget.cmd,
      args: [...binaryArgs],
      env: binaryTarget.env,
    };
  }

  // Try uvx as fallback
  if (dist.uvx) {
    const uvx = getUvxRunner();
    if (uvx) {
      const uvxArgs = Array.isArray(dist.uvx.args) ? dist.uvx.args : [];
      return {
        command: uvx,
        args: [dist.uvx.package, ...uvxArgs],
        env: dist.uvx.env,
      };
    }
  }

  return null;
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
    console.warn('Failed to fetch remote registry, using built-ins only:', err);
    return [];
  }
}

async function probeAgent(
  agent: RegistryAgent,
  launch: LaunchConfig
): Promise<DriverDiscovery> {
  const allArgs = [...launch.args];
  const child = spawn(launch.command, allArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...launch.env },
  });

  // Handle immediate spawning errors (like ENOENT) to prevent server crash
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

  const connection = new ClientSideConnection(() => {
    return {
      async sessionUpdate() {
        // Probe only needs initialization
      },
      async requestPermission() {
        const result = { outcome: { outcome: 'selected' as const, optionId: 'allow-always' } };
        return await Promise.resolve(result);
      }
    };
  }, stream);

  try {
    const result = await Promise.race([
      (async () => {
        const initResult = await connection.initialize({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-probe', version: '1.0.0' }
        });

        const initResultTyped = initResult as Record<string, unknown>;
        const configOptions = initResultTyped.configOptions as ACPConfigOption[] | undefined;

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
        // Increased timeout to 30s to allow for npx initialization
        setTimeout(() => {
          reject(new Error(`Probe for ${agent.id} timed out after 30s`));
        }, 30_000);
      }),
    ]);

    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Probe failed for ${agent.id}:`, err);
    return {
      id: agent.id,
      label: agent.name,
      status: 'error',
      command: launch.command,
      launchArgs: launch.args,
      launchEnv: launch.env,
      version: agent.version,
      description: agent.description,
      icon: agent.icon,
    };
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
      
      // Merge built-in agents with registry agents, avoiding duplicates
      const allAgentsMap = new Map<string, RegistryAgent>();
      for (const agent of BUILTIN_AGENTS) {
        allAgentsMap.set(agent.id, agent);
      }
      for (const agent of registryAgents) {
        allAgentsMap.set(agent.id, agent);
      }
      
      const agents = Array.from(allAgentsMap.values());

      const launchable = agents
        .map((agent) => ({ agent, launch: resolveLaunchConfig(agent) }))
        .filter((entry): entry is { agent: RegistryAgent; launch: LaunchConfig } => entry.launch !== null);

      const probes = launchable.map(({ agent, launch }) => probeAgent(agent, launch));
      this.cachedDrivers = await Promise.all(probes);
      this.lastFetchTime = now;
    }

    return this.cachedDrivers;
  }

  async getDriver(id: string): Promise<DriverDiscovery | undefined> {
    const drivers = await this.discover();
    return drivers.find((d) => d.id === id);
  }
}
