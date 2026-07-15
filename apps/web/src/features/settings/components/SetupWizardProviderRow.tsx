import { Input, Button } from '@agentctl/ui';
import { ProviderIcon } from '@/shared/ProviderIcon';
import { getProviderEnvKeys, validateApiKey, type ProviderDiscovery } from '@agentctl/shared';

interface SetupWizardProviderRowProps {
  provider: ProviderDiscovery;
  localCustomEnvs: Record<string, Record<string, string> | undefined>;
  onEnvChange: (providerId: string, key: string, value: string) => void;
  onSaveConfig: (providerId: string, customEnv: Record<string, string>) => void;
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

  const keysValues = envKeys.reduce<Record<string, string>>((acc, key) => {
    const envs = localCustomEnvs[provider.id] ?? {};
    // `envs`/`provider.customEnv` index access can be undefined at runtime; the lint
    // rule misreads this index-signature value type as always defined.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    acc[key] = envs[key] ?? provider.customEnv[key] ?? '';
    return acc;
  }, {});

  const hasChanges = envKeys.some((key) => {
    const val = keysValues[key];
    return val !== (provider.customEnv[key] ?? '');
  });

  return (
    <div className="bg-surface-secondary/20 border-border/10 hover:border-border/30 animate-in fade-in flex flex-col gap-2.5 rounded-xl border p-3 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderIcon provider={provider} size="sm" />
          <div className="min-w-0">
            <div className="text-text-main truncate label-xs">
              {provider.label}
            </div>
            <div className="text-text-muted mt-0.5 text-[8px] font-black tracking-widest uppercase opacity-45">
              {provider.installState === 'not_installed'
                ? 'SUPPORTED'
                : provider.authState === 'authenticated'
                  ? 'ACTIVE'
                  : (provider.authState ?? provider.installState ?? 'unknown').replace('_', ' ')}
            </div>
          </div>
        </div>
      </div>
      {isActive && hasKeys && (
        <div className="border-border/10 space-y-2 border-t pt-2.5">
          <div className="space-y-2">
            {envKeys.map((key) => {
              const errorMsg = validateApiKey(key, keysValues[key]);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <label className="text-text-muted text-[8px] font-black tracking-widest uppercase">
                      {key}
                    </label>
                    {errorMsg && (
                      <span className="text-danger text-[8px] font-bold tracking-tight uppercase">
                        {errorMsg}
                      </span>
                    )}
                  </div>
                  <Input
                    type="password"
                    value={keysValues[key]}
                    onChange={(e) => {
                      onEnvChange(provider.id, key, e.target.value);
                    }}
                    className={`!h-8 w-full !text-[11px] ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
                  />
                </div>
              );
            })}
            {hasChanges && (
              <div className="flex justify-end pt-1">
                <Button
                  onClick={() => { onSaveConfig(provider.id, keysValues); }}
                  disabled={
                    isUpdatingConfig ||
                    envKeys.some((key) => validateApiKey(key, keysValues[key]) !== null)
                  }
                  className="h-7 px-3 text-[9px] font-bold tracking-widest"
                >
                  {isUpdatingConfig ? 'CONNECTING...' : 'SAVE_CONFIG'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
