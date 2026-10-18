import { expect, test } from 'vite-plus/test';
import * as core from './index.js';
import { WorkspaceManager, SessionWorkspace as GitSessionWorkspace } from './git/index.js';
import { SessionWorkspace } from './workspace/index.js';
import { ProviderRegistry } from './providers/provider-registry.js';

test('keeps deliberate public host facades while hiding registry implementations', () => {
  expect(core.WorkspaceManager).toBe(WorkspaceManager);
  expect(core.ProviderRegistry).toBe(ProviderRegistry);
  expect(core.SessionWorkspace).toBe(GitSessionWorkspace);
  expect(GitSessionWorkspace.prototype).toBeInstanceOf(SessionWorkspace);
  expect(core).not.toHaveProperty('BinaryInstaller');
  expect(core).not.toHaveProperty('ProviderStore');
});
