import { useMemo } from 'react';
import { getProviderEnvKeys, validateApiKey, type ProviderDiscovery } from '@agentctl/shared';

interface ProviderEnvKeysResult {
  envKeys: string[];
  keysValues: Record<string, string>;
  hasChanges: boolean;
  hasInvalidKeys: boolean;
  getError: (key: string) => string | null;
}

export function useProviderEnvKeys(
  provider: ProviderDiscovery,
  localCustomEnvs?: Record<string, string>,
  localProviderId?: string,
): ProviderEnvKeysResult {
  const envKeys = useMemo(() => getProviderEnvKeys(provider), [provider]);

  const keysValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const key of envKeys) {
      if (localCustomEnvs && localProviderId) {
        values[key] = localCustomEnvs[key] ?? (provider.customEnv[key] || '');
      } else {
        values[key] = provider.customEnv[key] ?? '';
      }
    }
    return values;
  }, [envKeys, provider, localCustomEnvs, localProviderId]);

  const hasChanges = useMemo(() => {
    return envKeys.some((key) => {
      const current = keysValues[key];
      return (
        current !==
        (localCustomEnvs ? provider.customEnv[key] || '' : (provider.customEnv[key] ?? ''))
      );
    });
  }, [envKeys, keysValues, provider, localCustomEnvs]);

  const hasInvalidKeys = useMemo(() => {
    return envKeys.some((key) => validateApiKey(key, keysValues[key] ?? '') !== null);
  }, [envKeys, keysValues]);

  const getError = (key: string) => validateApiKey(key, keysValues[key] ?? '');

  return { envKeys, keysValues, hasChanges, hasInvalidKeys, getError };
}
