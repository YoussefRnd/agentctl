import { test, describe, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AgentSideConnection,
  ClientSideConnection,
  ndJsonStream,
  type Agent,
} from '@agentclientprotocol/sdk';
import { createClientHandlers } from './client-handlers.js';
import { TerminalManager } from './terminal-manager.js';
import { noopLogger } from '../../logger.js';
import type { SessionCallbacks } from '../types.js';
import type { ElicitationRequest } from '@agentctl/shared';

/**
 * Regression guard for the dead-handler bug: agentctl previously exposed
 * dotted/slashed keys ('fs.readTextFile', 'terminal/create') which the SDK
 * never dispatches -- every call silently fell through to the generic
 * fallback and agents received `{}`.
 *
 * This test wires the real SDK pair (AgentSideConnection + ClientSideConnection
 * over TransformStreams) so a request truly traverses JSON-RPC dispatch.
 * If a handler key stops matching the SDK dispatch table, the assertion fails.
 */

let clientConnection: AgentSideConnection;
let lastElicitation: ElicitationRequest | undefined;

async function makePair(cwd: string) {
  const clientToAgent = new TransformStream<Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array>();

  const callbacks = {
    onEvent: () => Promise.resolve(),
    onRequestPermission: () => Promise.resolve({ allowed: true, optionId: 'allow-once' }),
    onRequestElicitation: (request: ElicitationRequest) => {
      lastElicitation = request;
      return Promise.resolve({
        action: 'submit' as const,
        values: { strategy: 'balanced', ignored: { nested: true } },
      });
    },
  } as unknown as SessionCallbacks;

  const client = createClientHandlers({
    cwd: process.cwd(),
    terminalManager: new TerminalManager(noopLogger),
    logger: noopLogger,
    resolveSession: () => ({ callbacks, cwd }),
  });

  const fakeAgent = {} as unknown as Agent;

  new ClientSideConnection(
    () => client,
    // Node's TransformStream<Uint8Array> readable side is typed `any`;
    // runtime chunk type verified by the passing dispatch tests below.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ndJsonStream(clientToAgent.writable, agentToClient.readable),
  );
  clientConnection = new AgentSideConnection(
    () => fakeAgent,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  lastElicitation = undefined;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
  return makePair(dir);
});

describe('real SDK dispatch parity (regression for dead handler keys)', () => {
  test('readTextFile reaches the handler instead of the extMethod fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
    await makePair(dir);
    const file = path.join(dir, 'sdk.txt');
    fs.writeFileSync(file, 'sdk-dispatched-content');

    const res = await clientConnection.readTextFile({ sessionId: 's1', path: file });
    expect(res.content).toBe('sdk-dispatched-content');
  });

  test('writeTextFile reaches the handler instead of the extMethod fallback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
    await makePair(dir);
    const file = path.join(dir, 'out.txt');

    await clientConnection.writeTextFile({ sessionId: 's1', path: file, content: 'written' });
    expect(fs.readFileSync(file, 'utf8')).toBe('written');
  });

  test('requestPermission reaches the handler and returns the selected option', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
    await makePair(dir);

    const res = await clientConnection.requestPermission({
      sessionId: 's1',
      toolCall: { toolCallId: 't1', title: 'Perm' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    expect(res.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  test('createElicitation maps the stabilized ACP form shape', async () => {
    const res = await clientConnection.createElicitation({
      sessionId: 's1',
      mode: 'form',
      message: 'Choose a strategy',
      requestedSchema: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            title: 'Strategy',
            oneOf: [
              { const: 'balanced', title: 'Balanced' },
              { const: 'fast', title: 'Fast' },
            ],
          },
        },
        required: ['strategy'],
      },
    });

    expect(lastElicitation).toMatchObject({
      mode: 'form',
      message: 'Choose a strategy',
      sessionId: 's1',
      form: {
        fields: [
          {
            id: 'strategy',
            label: 'Strategy',
            type: 'select',
            required: true,
          },
        ],
      },
    });
    expect(res).toEqual({ action: 'accept', content: { strategy: 'balanced' } });
  });

  test('extMethod builtin/bash dispatches to the terminal manager', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
    await makePair(dir);

    const res = await clientConnection.extMethod('builtin/bash', {
      sessionId: 's1',
      command: 'pwd',
      pty: false,
    });
    expect(res).toHaveProperty('output');
    expect((res as { output: string }).output).toContain(dir);
  }, 15000);

  test('unknown extMethod returns empty object instead of throwing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentctl-sdk-'));
    await makePair(dir);

    const res = await clientConnection.extMethod('totally/unknown', { sessionId: 's1' });
    expect(res).toEqual({});
  });
});
