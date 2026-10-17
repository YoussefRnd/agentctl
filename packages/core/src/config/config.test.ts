import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { findWorkspaceRoot, loadWorkspaceEnv } from './workspace.js';
import { DEFAULT_CONTEXT_TURN_LIMIT, getContextTurnLimit } from './runtime-defaults.js';

test('workspace environment loading is explicit, rooted, and preserves existing values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentctl-config-'));
  vi.stubEnv('AGENTCTL_CONFIG_EXISTING_TEST', 'existing');
  try {
    await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'), 'packages: []');
    await fs.writeFile(
      path.join(directory, '.env'),
      'AGENTCTL_CONFIG_LOADED_TEST=from-file\nAGENTCTL_CONFIG_EXISTING_TEST=from-file',
    );
    const nested = path.join(directory, 'nested', 'child');
    await fs.mkdir(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(directory);
    expect(process.env.AGENTCTL_CONFIG_LOADED_TEST).toBeUndefined();
    expect(loadWorkspaceEnv(nested)).toBe(directory);
    expect(process.env.AGENTCTL_CONFIG_LOADED_TEST).toBe('from-file');
    expect(process.env.AGENTCTL_CONFIG_EXISTING_TEST).toBe('existing');
  } finally {
    delete process.env.AGENTCTL_CONFIG_LOADED_TEST;
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('runtime settings are resolved on use and reject invalid positive integers', () => {
  try {
    for (const value of ['0', '-1', '1.5', 'Infinity', 'not-a-number', '9007199254740992']) {
      vi.stubEnv('AGENTCTL_CONTEXT_TURN_LIMIT', value);
      expect(getContextTurnLimit()).toBe(DEFAULT_CONTEXT_TURN_LIMIT);
    }
    vi.stubEnv('AGENTCTL_CONTEXT_TURN_LIMIT', '25');
    expect(getContextTurnLimit()).toBe(25);
  } finally {
    vi.unstubAllEnvs();
  }
});
