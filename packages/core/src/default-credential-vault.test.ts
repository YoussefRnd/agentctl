import { expect, test, vi } from 'vite-plus/test';
const constructed = vi.hoisted(() => vi.fn());
vi.mock('./security/credential-vault.js', async (original) => {
  const actual = await original<typeof import('./security/credential-vault.js')>();
  return {
    ...actual,
    CredentialVault: class extends actual.CredentialVault {
      constructor(...args: ConstructorParameters<typeof actual.CredentialVault>) {
        super(...args);
        constructed();
      }
    },
  };
});
import {
  defaultCredentialResolver,
  getDefaultCredentialVault,
} from './default-credential-vault.js';

test('credential imports create no instance and explicit access shares one owner', () => {
  expect(constructed).not.toHaveBeenCalled();
  expect(defaultCredentialResolver.resolveEnvSync).toBeTypeOf('function');
  const vault = getDefaultCredentialVault();
  expect(getDefaultCredentialVault()).toBe(vault);
  expect(constructed).toHaveBeenCalledOnce();
});
