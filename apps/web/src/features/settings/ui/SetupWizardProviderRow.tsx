import { Input, Button } from '@agentctl/ui';
import { ProviderIcon } from '@/shared';
import {
  getProviderEnvKeys,
  isProviderEnvKeyOptional,
  validateApiKey,
  type ProviderDiscovery,
} from '@agentctl/shared';

interface SetupWizardProviderRowProps {
  provider: ProviderDiscovery;
  localCustomEnvs: Record<string, Record<string, string> | undefined>;
  onEnvChange: (providerId: string, key: string, value: string) => void;
  onSaveConfig: (providerId: string, customEnv: Record<string, string>) => Promise<void>;
  isUpdatingConfig: boolean;
}

export function SetupWizardProviderRow({
  provider,
  localCustomEnvs,
  onEnvChange,
  onSaveConfig,
  isUpdatingConfig,
}: SetupWizardProviderRowProps) {
  const isActive = provider.installState !== 'not_installed';
  const envKeys = getProviderEnvKeys(provider);
  const hasKeys = envKeys.length > 0;
  const localEnv = localCustomEnvs[provider.id] ?? {};

  const keysValues = envKeys.reduce<Record<string, string>>((acc, key) => {
    acc[key] = localEnv[key] ?? '';
    return acc;
  }, {});

  const hasChanges = Object.keys(localEnv).length > 0;

  const getKeyError = (key: string): string | null => {
    if (isProviderEnvKeyOptional(provider, key) && (localEnv[key]?.trim() ?? '') === '')
      return null;
    if (key in localEnv) return validateApiKey(key, localEnv[key] ?? '');
    if (provider.customEnvConfigured[key]) return null;
    return validateApiKey(key, '');
  };

  return (
    <div className="bg-surface-secondary/20 border-border/10 hover:border-border/30 animate-in fade-in flex flex-col gap-2.5 rounded-xl border p-3 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderIcon provider={provider} size="sm" />
          <div className="min-w-0">
            <div className="text-text-main truncate text-xs font-semibold">{provider.label}</div>
            <div className="text-text-muted mt-0.5 text-[10px] font-medium opacity-60">
              {provider.installState === 'not_installed'
                ? 'Supported'
                : provider.authState === 'authenticated'
                  ? 'Authenticated'
                  : provider.authState === 'not_required'
                    ? 'Connected · No authentication needed'
                    : provider.authState === 'required'
                      ? 'Auth Required'
                      : provider.authState === 'error'
                        ? 'Error'
                        : 'Not Authenticated'}
            </div>
          </div>
        </div>
      </div>
      {isActive && hasKeys && (
        <div className="border-border/10 space-y-2 border-t pt-2.5">
          <div className="space-y-2">
            {envKeys.map((key) => {
              const errorMsg = getKeyError(key);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <label
                      htmlFor={`setup-${provider.id}-${key}`}
                      className="text-text-muted font-mono text-xs font-medium"
                    >
                      {key}
                    </label>
                    {errorMsg && (
                      <span className="text-danger text-xs font-normal">{errorMsg}</span>
                    )}
                  </div>
                  <Input
                    id={`setup-${provider.id}-${key}`}
                    type="password"
                    value={keysValues[key]}
                    placeholder={
                      provider.customEnvConfigured[key]
                        ? 'Configured (enter to replace)'
                        : `Enter ${key}...`
                    }
                    onChange={(e) => {
                      onEnvChange(provider.id, key, e.target.value);
                    }}
                    className={`!h-8 w-full font-mono !text-xs ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
                  />
                </div>
              );
            })}
            {hasChanges && (
              <div className="flex justify-end pt-1">
                <Button
                  onClick={() => {
                    void onSaveConfig(provider.id, localEnv);
                  }}
                  disabled={isUpdatingConfig || envKeys.some((key) => getKeyError(key) !== null)}
                  className="bg-accent text-brand-crust h-7 px-3 text-xs font-medium hover:opacity-90"
                >
                  {isUpdatingConfig ? 'Connecting...' : 'Save configuration'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
