/** Secret storage contract. Launch/configuration code never owns encrypted-file state. */
export interface CredentialStore {
  isSecretRef(value: string): boolean;
  createSecretRef(providerId: string, key: string): string;
  getSecret(ref: string): Promise<string | null>;
  getSecretSync(ref: string): string | null;
  setSecret(providerId: string, key: string, value: string): Promise<string>;
  setProviderSecrets(
    providerId: string,
    updates: Record<string, string | null>,
  ): Promise<Record<string, string>>;
  snapshotProviderSecrets(providerId: string): Record<string, string>;
  restoreProviderSecrets(providerId: string, snapshot: Record<string, string>): Promise<void>;
  deleteSecret(ref: string): Promise<void>;
  deleteProviderSecrets(providerId: string): Promise<void>;
  resolveEnv(env: Record<string, string>): Promise<Record<string, string>>;
  resolveEnvSync(env: Record<string, string>): Record<string, string>;
}
