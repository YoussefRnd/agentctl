import { execSync, spawn } from 'node:child_process';
import { ACPClient } from './acp-client.js';
import type { DriverDiscovery, ACPConfigOption } from '@agentctl/shared';

function isBinaryInstalled(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function probeDriver(
  id: string,
  label: string,
  command: string
): Promise<DriverDiscovery> {
  if (!isBinaryInstalled(command)) {
    return { id, label, status: 'not_found', command };
  }

  const acpFlag = id === 'claude-code' ? '-p' : '--acp';
  const child = spawn(command, [acpFlag], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const client = new ACPClient(child);

  // Suppress stderr errors during probe as they might be noisy or expected during initialization
  client.removeAllListeners('error');
  client.on('error', () => { /* ignore */ });

  try {
    const result = await Promise.race([
      (async () => {
        await client.initialize();
        const response = (await client.call('session/new', {
          workingDirectory: process.cwd(),
        })) as { configOptions?: ACPConfigOption[] };

        return {
          id,
          label,
          status: 'ready' as const,
          command,
          configOptions: response.configOptions,
        };
      })(),
      new Promise<DriverDiscovery>((_, reject) => {
        setTimeout(() => { reject(new Error(`Probe for ${id} timed out`)); }, 5000);
      }),
    ]);

    return result;
  } catch {
    return { id, label, status: 'error', command };
  } finally {
    client.kill();
  }
}

export class DriverRegistry {
  private static readonly SUPPORTED_DRIVERS = [
    { id: 'claude-code', label: 'Claude Code', command: 'claude' },
    { id: 'gemini-cli', label: 'Gemini CLI', command: 'gemini' },
    { id: 'opencode', label: 'OpenCode', command: 'opencode' },
    { id: 'codex-acp', label: 'Codex ACP', command: 'codex' },
  ] as const;

  private cachedDrivers: DriverDiscovery[] | null = null;
  private lastFetchTime = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async discover(): Promise<DriverDiscovery[]> {
    const now = Date.now();
    if (!this.cachedDrivers || now - this.lastFetchTime > DriverRegistry.CACHE_TTL) {
      const probes = DriverRegistry.SUPPORTED_DRIVERS.map((d) =>
        probeDriver(d.id, d.label, d.command)
      );
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
