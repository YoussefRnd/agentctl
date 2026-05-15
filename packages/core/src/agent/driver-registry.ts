import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import { ACPClient } from './acp-client.js';
import type { DriverDiscovery, ACPConfigOption, RegistryAgent } from '@agentctl/shared';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

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
      return {
        command: npx,
        args: [dist.npx.package, ...dist.npx.args],
        env: dist.npx.env,
      };
    }
  }

  // Try binary for current platform
  const binaryTarget = dist.binary?.[platform];
  if (binaryTarget) {
    return {
      command: binaryTarget.cmd,
      args: binaryTarget.args,
      env: binaryTarget.env,
    };
  }

  // Try uvx as fallback
  if (dist.uvx) {
    const uvx = getUvxRunner();
    if (uvx) {
      return {
        command: uvx,
        args: [dist.uvx.package, ...dist.uvx.args],
        env: dist.uvx.env,
      };
    }
  }

  return null;
}

async function fetchRegistry(): Promise<RegistryAgent[]> {
  const response = await fetch(REGISTRY_URL);

  if (!response.ok) {
    throw new Error(`Failed to fetch ACP registry: ${String(response.status)} ${response.statusText}`);
  }

  const data = (await response.json()) as { agents: RegistryAgent[] };
  return data.agents;
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

  const client = new ACPClient(child);
  client.removeAllListeners('error');
  client.on('error', () => { /* ignore during probe */ });

  try {
    const result = await Promise.race([
      (async () => {
        await client.initialize();
        const response = (await client.call('session/new', {
          workingDirectory: process.cwd(),
        })) as { configOptions?: ACPConfigOption[] };

        return {
          id: agent.id,
          label: agent.name,
          status: 'ready' as const,
          command: launch.command,
          launchArgs: launch.args,
          launchEnv: launch.env,
          configOptions: response.configOptions,
          version: agent.version,
          description: agent.description,
          icon: agent.icon,
        };
      })(),
      new Promise<DriverDiscovery>((_, reject) => {
        setTimeout(() => { reject(new Error(`Probe for ${agent.id} timed out`)); }, 10_000);
      }),
    ]);

    return result;
  } catch {
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
    client.kill();
  }
}

export class DriverRegistry {
  private cachedDrivers: DriverDiscovery[] | null = null;
  private lastFetchTime = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

  async discover(): Promise<DriverDiscovery[]> {
    const now = Date.now();
    if (!this.cachedDrivers || now - this.lastFetchTime > DriverRegistry.CACHE_TTL) {
      const agents = await fetchRegistry();

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
