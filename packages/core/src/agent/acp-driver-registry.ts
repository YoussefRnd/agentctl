import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import type { DriverDiscovery, RegistryAgent } from '@agentctl/shared';
import { type Logger, noopLogger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';
import { notFoundEntry, probeAgent } from './acp-probe.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const SUPPORTED_AGENTS = new Set([
  'opencode',
  'claude-acp',
  'claude-code-acp',
  'gemini',
  'gemini-acp',
  'codex-acp',
  'claude-code',
  'gemini-cli',
]);

const LOCAL_BINARY_HINTS = [
  { id: 'gemini', command: 'gemini', args: ['--acp'], label: 'Gemini CLI (Local)' },
  { id: 'opencode', command: 'opencode', args: ['acp'], label: 'OpenCode (Local)' },
  { id: 'codex-acp', command: 'codex-acp', args: [], label: 'Codex ACP (Local)' },
  { id: 'claude-acp', command: 'claude-agent-acp', args: [], label: 'Claude ACP Bridge (Local)' },
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
    if (command.startsWith('./')) {
      if (!fs.existsSync(command)) {
        command = command.substring(2);
      }
    }

    return {
      command,
      args: [...binaryTarget.args],
      env: binaryTarget.env,
    };
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
  private cachedDrivers: DriverDiscovery[] | null = null;
  private lastFetchTime = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000;

  constructor(private logger: Logger = noopLogger) {}

  async discover(): Promise<DriverDiscovery[]> {
    const now = Date.now();
    if (this.cachedDrivers && now - this.lastFetchTime < DriverRegistry.CACHE_TTL) {
      return this.cachedDrivers;
    }

    this.logger.info('Starting agent discovery...');
    const registryAgents = await fetchRegistry(this.logger);
    const supportedRegistry = registryAgents.filter((a) => SUPPORTED_AGENTS.has(a.id));

    const results: DriverDiscovery[] = [];

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
          results.push(probeResult);
        }
      }
    }

    // 2. Process registry agents (only those not already found locally)
    const pendingProbes = supportedRegistry
      .filter((agent) => !results.some((r) => r.id === agent.id))
      .map(async (agent) => {
        const launch = resolveLaunchConfig(agent);
        if (!launch) return notFoundEntry(agent);
        return probeAgent(agent, launch, this.logger);
      });

    const registryResults = await Promise.all(pendingProbes);
    results.push(...registryResults);

    this.cachedDrivers = results;
    this.lastFetchTime = now;
    return results;
  }

  async getDriver(id: string): Promise<DriverDiscovery | undefined> {
    const drivers = await this.discover();
    return drivers.find((d) => d.id === id);
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

      // Clear cache so the status updates to 'ready' on next discovery
      this.cachedDrivers = null;
    } finally {
      child.kill();
    }
  }
}
