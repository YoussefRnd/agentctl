import os from 'node:os';
import type { ProviderDiscovery, ACPConfigOption, RegistryAgent } from '@agentctl/shared';
import { type Logger } from '../logger.js';
import { createAgentConnection } from './acp-transport.js';

/** Shape returned by Gemini CLI's newSession when it uses the legacy models/modes format. */
interface GeminiModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

interface GeminiModeInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * Extended session result covering both standard ACP (`configOptions`) and
 * Gemini CLI's legacy format (`models` / `modes`).
 */
interface ExtendedSessionResult {
  sessionId?: string;
  configOptions?: ACPConfigOption[] | null;
  models?: { currentModelId?: string; availableModels?: GeminiModelInfo[] };
  modes?: { currentModeId?: string; availableModes?: GeminiModeInfo[] };
}

/** Optional dynamic-capability methods that some agents expose beyond the core ACP spec. */
interface DynamicCapableConnection {
  unstable_setSessionModel?: (params: { sessionId: string; modelId: string }) => Promise<unknown>;
  setSessionConfigOption?: (params: {
    sessionId: string;
    configId: string;
    value: string;
  }) => Promise<unknown>;
}

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

export function notFoundEntry(agent: RegistryAgent, enabled = false): ProviderDiscovery {
  return {
    id: agent.id,
    label: agent.name,
    status: 'not_found',
    command: agent.id,
    enabled,
    launchArgs: [],
    launchEnv: {},
    customEnv: {},
    authMethods: [],
    version: agent.version,
    description: agent.description,
    icon: agent.icon,
    supportsDynamicModel: false,
    supportsDynamicConfig: false,
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
): Promise<ProviderDiscovery> {
  const createConnection = options.createConnection ?? createAgentConnection;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const { child, connection } = createConnection(launch.command, launch.args, launch.env);
  // Cast to the superset so we can probe optional dynamic-capability methods without `any`.
  const dynConnection = connection as typeof connection & DynamicCapableConnection;

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
        let supportsDynamicModel = false;
        let supportsDynamicConfig = false;

        try {
          const sessionResult = (await connection.newSession({
            cwd: os.tmpdir(),
            mcpServers: [],
          })) as ExtendedSessionResult;

          if (sessionResult.configOptions) {
            configOptions = sessionResult.configOptions;
          } else {
            // Gemini CLI legacy format: models / modes instead of configOptions
            const models = sessionResult.models;
            if (models?.availableModels) {
              configOptions.push({
                id: 'model',
                name: 'Model',
                description: 'Select the model to use',
                type: 'select',
                currentValue: models.currentModelId ?? '',
                options: models.availableModels.map((m) => ({
                  value: m.modelId,
                  name: m.name,
                  description: m.description,
                })),
              });
            }
            const modes = sessionResult.modes;
            if (modes?.availableModes) {
              configOptions.push({
                id: 'mode',
                name: 'Mode',
                description: 'Select the tool approval mode',
                type: 'select',
                currentValue: modes.currentModeId ?? '',
                options: modes.availableModes.map((m) => ({
                  value: m.id,
                  name: m.name,
                  description: m.description,
                })),
              });
            }
          }

          const sessionId = sessionResult.sessionId;
          if (sessionId) {
            // Probe unstable_setSessionModel capability
            if (typeof dynConnection.unstable_setSessionModel === 'function') {
              try {
                await dynConnection.unstable_setSessionModel({
                  sessionId,
                  modelId: 'probe-test-model-id',
                });
                supportsDynamicModel = true;
              } catch (err: unknown) {
                const rpcErr = err as { code?: number };
                if (rpcErr.code !== -32601) {
                  supportsDynamicModel = true;
                }
              }
            }

            // Probe setSessionConfigOption capability
            if (typeof dynConnection.setSessionConfigOption === 'function') {
              try {
                await dynConnection.setSessionConfigOption({
                  sessionId,
                  configId: 'probe-test-config-id',
                  value: 'probe-test-value',
                });
                supportsDynamicConfig = true;
              } catch (err: unknown) {
                const rpcErr = err as { code?: number };
                if (rpcErr.code !== -32601) {
                  supportsDynamicConfig = true;
                }
              }
            }
          }
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
          customEnv: {},
          configOptions,
          authMethods: initResult.authMethods ?? [],
          version: agent.version,
          description: agent.description,
          icon: agent.icon,
          supportsDynamicModel,
          supportsDynamicConfig,
        };
      })(),
      new Promise<ProviderDiscovery>((_, reject) => {
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
