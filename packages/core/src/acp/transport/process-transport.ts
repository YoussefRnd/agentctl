import { observeAcpStderr } from './stderr.js';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import { agentConnectionFacade } from './client-connection.js';
import { respondToBrowserAuthentication } from '../protocol/browser-auth.js';
import type { AgentAuthenticationOptions } from '../../agent/types.js';
import type { ACPConnectionHandle } from '../types.js';
import { ACP_PROCESS_OPTIONS, ownAcpProcess, cleanEnv } from './acp-process-lifecycle.js';

export { ProcessStreamTransport, cleanEnv } from './acp-process-lifecycle.js';

export function createAgentConnection(
  command: string,
  args: string[],
  env: Record<string, string>,
  spawnImpl: typeof spawn = spawn,
  authOptions: AgentAuthenticationOptions = {},
): ACPConnectionHandle {
  const child = ownAcpProcess(
    spawnImpl(command, args, {
      ...ACP_PROCESS_OPTIONS,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv(env),
      cwd: os.tmpdir(),
    }),
    spawnImpl === spawn,
  );

  observeAcpStderr(child, cleanEnv(env));
  const stdin = child.stdin as typeof child.stdin | null;
  const stdout = child.stdout as typeof child.stdout | null;

  if (stdin === null || stdout === null) {
    child.kill();
    throw new Error('Spawned agent missing stdin/stdout');
  }

  const stream = ndJsonStream(
    Writable.toWeb(stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(stdout) as ReadableStream<Uint8Array>,
  );

  const app = client({ name: 'agentctl-control' })
    .onNotification(methods.client.session.update, () => undefined)
    .onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: 'cancelled' },
    }))
    .onRequest(methods.client.elicitation.create, ({ params, signal }) =>
      respondToBrowserAuthentication(params, signal, authOptions),
    );
  const connection = agentConnectionFacade(app.connect(stream));

  return { child, connection };
}
