import { CredentialVault } from './security/credential-vault.js';
import type { CredentialStore } from './security/credential-store.js';

let vault: CredentialVault | undefined;
/** Explicit lazy composition; imports never capture credential paths or create keys/files. */
export function getDefaultCredentialVault(): CredentialVault {
  return (vault ??= new CredentialVault());
}

/** Compatibility defaults for standalone read models resolve the same store only on use. */
export const defaultCredentialResolver: Pick<CredentialStore, 'resolveEnvSync'> = {
  resolveEnvSync: (env) => getDefaultCredentialVault().resolveEnvSync(env),
};
