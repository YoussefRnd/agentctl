import os from 'node:os';
import type { DriverDiscovery, ACPConfigOption, RegistryAgent } from '@agentctl/shared';
import { type Logger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';

export interface ProbeConnectionHandle {
  child: {
    on(event: 'error', listener: (error: unknown) => void): void;
    kill(): boolean;
  };
  connection: {
    initialize(params: {
      protocolVersion: number;
      clientInfo: { name: string; version: string };
    }): Promise<{
      authMethods?: { id: string; name: string }[];
    }>;
    newSession(params: { cwd: string; mcpServers: [] }): Promise<{
      configOptions?: ACPConfigOption[] | null;
    }>;
    closed: Promise<void>;
  };
}

const PROBE_TIMEOUT_MS = 60_000;

export function notFoundEntry(agent: RegistryAgent, enabled = false): DriverDiscovery {
  return {
    id: agent.id,
    label: agent.name,
    status: 'not_found',
    command: agent.id,
    enabled,
    launchArgs: [],
    launchEnv: {},
    authMethods: [],
    version: agent.version,
    description: agent.description,
    icon: agent.icon,
  };
}

export interface ProbeAgentOptions {
  timeoutMs?: number;
  createConnection?: (
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => ProbeConnectionHandle;
}

export async function probeAgent(
  agent: RegistryAgent,
  launch: { command: string; args: string[]; env: Record<string, string> },
  logger: Logger,
  options: ProbeAgentOptions = {},
): Promise<DriverDiscovery> {
  const createConnection = options.createConnection ?? createAgentConnection;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const { child, connection } = createConnection(launch.command, launch.args, launch.env);

  child.on('error', (err) => {
    logger.warn(err, `Spawning agent ${agent.id} failed`);
  });

  try {
    const result = await Promise.race([
      (async () => {
        const initResult = await connection.initialize({
          protocolVersion: 1,
          clientInfo: { name: 'agentctl-probe', version: '1.0.0' },
        });

        let status: 'ready' | 'needs_auth' = 'ready';
        let configOptions: ACPConfigOption[] = [];

        try {
          const sessionResult = await connection.newSession({
            cwd: os.tmpdir(),
            mcpServers: [],
          });
          configOptions = (sessionResult.configOptions as ACPConfigOption[] | null) ?? [];
        } catch (err: unknown) {
          const error = err as { code?: string; data?: { configOptions?: ACPConfigOption[] } };
          if (error.code === 'auth_required') {
            status = 'needs_auth';
            if (error.data?.configOptions) {
              configOptions = error.data.configOptions;
            }
          } else {
            throw err;
          }
        }

        return {
          id: agent.id,
          label: agent.name,
          status,
          command: launch.command,
          enabled: false,
          launchArgs: launch.args,
          launchEnv: launch.env,
          configOptions,
          authMethods: initResult.authMethods ?? [],
          version: agent.version,
          description: agent.description,
          icon: agent.icon,
        };
      })(),
      new Promise<DriverDiscovery>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Probe for ${agent.id} timed out`));
        }, timeoutMs);
      }),
    ]);

    return result;
  } catch (err) {
    logger.error(err, `Probe failed for ${agent.id}`);
    return notFoundEntry(agent);
  } finally {
    child.kill();
  }
}
