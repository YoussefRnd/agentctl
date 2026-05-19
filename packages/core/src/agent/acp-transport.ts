import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk';

export interface ACPConnectionHandle {
  child: ChildProcess;
  connection: Pick<ClientSideConnection, 'initialize' | 'newSession' | 'authenticate' | 'closed'>;
}

export function cleanEnv(env: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  Object.assign(result, env);

  delete result.npm_config_engine_strict;
  delete result.npm_config_user_agent;
  delete result.npm_package_manager;
  return result;
}

export function createAgentConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  spawnImpl: typeof spawn = spawn,
): ACPConnectionHandle {
  const child = spawnImpl(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv(env),
    cwd: os.tmpdir(),
  });

  const stdin = child.stdin;
  const stdout = child.stdout;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (stdin === null || stdout === null) {
    child.kill();
    throw new Error('Spawned agent missing stdin/stdout');
  }

  const stream = ndJsonStream(
    Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
  );

  const connection = new ClientSideConnection(
    () => ({
      sessionUpdate() {
        return Promise.resolve();
      },
      requestPermission(request) {
        void request;
        return Promise.resolve<RequestPermissionResponse>({
          outcome: { outcome: 'selected', optionId: 'allow-once' },
        });
      },
    }),
    stream,
  );

  return { child, connection };
}
