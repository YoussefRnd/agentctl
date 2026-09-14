import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  type RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import type { ACPConnectionHandle } from '../types.js';
import { cleanEnv } from './acp-process-lifecycle.js';

export { ProcessStreamTransport, cleanEnv } from './acp-process-lifecycle.js';

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
      async readTextFile(p: { path: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        if (!fs.existsSync(absPath)) {
          throw new Error(`File not found: ${absPath}`);
        }
        const content = fs.readFileSync(absPath, 'utf8');
        return Promise.resolve({ content });
      },
      async writeTextFile(p: { path: string; content: string }) {
        const absPath = path.isAbsolute(p.path) ? p.path : path.resolve(os.tmpdir(), p.path);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absPath, p.content, 'utf8');
        return Promise.resolve({});
      },
    }),
    stream,
  );

  return { child, connection };
}
