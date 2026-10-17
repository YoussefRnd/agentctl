import { CredentialVault } from './security/credential-vault.js';
import type { CredentialStore } from './security/credential-store.js';

let vault: CredentialVault | undefined;
/** Explicit lazy composition; imports never capture credential paths or create keys/files. */
export function getDefaultCredentialVault(): CredentialVault {
  return (vault ??= new CredentialVault());
}

/** Standalone read models share this explicit lazy credential resolver. */
export const defaultCredentialResolver: Pick<CredentialStore, 'resolveEnvSync'> = {
  resolveEnvSync: (env) => getDefaultCredentialVault().resolveEnvSync(env),
};
