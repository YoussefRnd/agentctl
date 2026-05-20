import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as spawnFn } from 'node:child_process';
import { cleanEnv, createAgentConnection } from './acp-transport.js';

test('cleanEnv overlays values and strips npm config variables', () => {
  const previousUserAgent = process.env.npm_config_user_agent;
  const previousCustom = process.env.AGENTCTL_TEST_FLAG;

  process.env.npm_config_user_agent = 'pnpm/11';
  process.env.AGENTCTL_TEST_FLAG = 'base';

  try {
    const env = cleanEnv({ AGENTCTL_TEST_FLAG: 'override' });

    assert.equal(env.AGENTCTL_TEST_FLAG, 'override');
    assert.equal(env.npm_config_user_agent, undefined);
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = previousUserAgent;
    }

    if (previousCustom === undefined) {
      delete process.env.AGENTCTL_TEST_FLAG;
    } else {
      process.env.AGENTCTL_TEST_FLAG = previousCustom;
    }
  }
});

test('createAgentConnection passes cleaned env to spawn and returns the child handle', () => {
  let killCount = 0;
  const stdin = new PassThrough();
  const stdout = new PassThrough();

  const child = {
    stdin,
    stdout,
    stderr: null,
    kill: () => {
      killCount += 1;
      return true;
    },
  } as unknown as ChildProcess;

  let capturedEnv: Record<string, string> | undefined;
  const fakeSpawn = ((
    command: string,
    args: string[],
    options: { env?: Record<string, string> },
  ) => {
    void command;
    void args;
    capturedEnv = options.env;
    return child;
  }) as unknown as typeof spawnFn;

  const previousUserAgent = process.env.npm_config_user_agent;
  process.env.npm_config_user_agent = 'pnpm/11';

  try {
    const handle = createAgentConnection(
      'agent',
      ['--probe'],
      { AGENTCTL_TEST_FLAG: '1' },
      fakeSpawn,
    );

    assert.equal(handle.child, child);
    assert.equal(capturedEnv?.AGENTCTL_TEST_FLAG, '1');
    assert.equal(capturedEnv.npm_config_user_agent, undefined);
    assert.equal(killCount, 0);

    stdin.destroy();
    stdout.destroy();
  } finally {
    if (previousUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = previousUserAgent;
    }
  }
});

test('createAgentConnection throws if stdio is missing', () => {
  let killCount = 0;
  const child = {
    stdin: null,
    stdout: null,
    stderr: null,
    kill: () => {
      killCount += 1;
      return true;
    },
  } as unknown as ChildProcess;

  const fakeSpawn = (() => child) as unknown as typeof spawnFn;

  assert.throws(() => {
    createAgentConnection('agent', [], {}, fakeSpawn);
  }, /missing stdin\/stdout/);
  assert.equal(killCount, 1);
});
