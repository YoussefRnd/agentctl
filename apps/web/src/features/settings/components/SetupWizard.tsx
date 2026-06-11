import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useProviders } from '../../../hooks/useProviders';
import { PROVIDER_ENV_KEYS, validateApiKey } from '@agentctl/shared';
import { Bot, Terminal } from 'lucide-react';
import { GlassPanel, Button, Input, Switch } from '@agentctl/ui';

export function SetupWizard() {
  const { showWizard, markDone } = useSetupWizard();
  const navigate = useNavigate();
  const {
    providers,
    activate,
    toggleProvider,
    isLoadingProviders,
    updateProviderConfig,
    isUpdatingConfig,
  } = useProviders(null);
  const [localCustomEnvs, setLocalCustomEnvs] = useState<
    Record<string, Record<string, string> | undefined>
  >({});

  const hasAnyInvalidProvider = providers.some((provider) => {
    if (!provider.enabled) return false;
    const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
    return envKeys.some((key) => {
      const val = localCustomEnvs[provider.id]?.[key] ?? (provider.customEnv[key] || '');
      return validateApiKey(key, val) !== null;
    });
  });

  const enabledProviders = providers.filter((provider) => provider.enabled);
  const defaultProviderId = enabledProviders[0]?.id ?? null;

  if (!showWizard) return null;

  return (
    <div className="bg-background/80 fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
      <GlassPanel intensity="high" className="relative z-10 flex w-full max-w-md flex-col rounded-3xl border-none p-5 shadow-2xl">
        <div className="mb-4 text-center">
          <h1 className="text-text-main text-xl font-black tracking-widest uppercase">
            INITIAL_SETUP::AI_PIPELINE
          </h1>
          <p className="text-text-muted mt-1 text-[10px] font-bold tracking-tight uppercase opacity-60">
            ENABLE_PROVIDERS_FOR_TASK_ORCHESTRATION.
          </p>
        </div>

        <div className="max-h-[320px] flex-1 space-y-2 overflow-y-auto py-1 pr-1">
          {isLoadingProviders ? (
            <div className="animate-pulse space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-surface-secondary/40 border-border/20 h-12 rounded-xl border"
                />
              ))}
            </div>
          ) : (
            providers.map((provider) => {
              const isActive = provider.enabled;
              const envKeys = PROVIDER_ENV_KEYS[provider.id] ?? [];
              const hasKeys = envKeys.length > 0;

              const keysValues = envKeys.reduce<Record<string, string>>((acc, key) => {
                acc[key] = localCustomEnvs[provider.id]?.[key] ?? (provider.customEnv[key] || '');
                return acc;
              }, {});

              const hasChanges = envKeys.some((key) => {
                const val = keysValues[key];
                return val !== (provider.customEnv[key] || '');
              });

              return (
                <div
                  key={provider.id}
                  className="bg-surface-secondary/20 border-border/20 hover:border-border/40 flex flex-col gap-2.5 rounded-xl border p-3 transition-colors animate-in fade-in"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="bg-background border-border/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border p-1">
                        {provider.icon ? (
                          <img src={provider.icon} alt="" className="h-4 w-4 object-contain" />
                        ) : provider.id.includes('claude') ? (
                          <span className="text-text-main text-xs font-bold">C</span>
                        ) : (
                          <Bot className="text-text-main h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-text-main truncate text-[11px] font-black tracking-tight uppercase">
                          {provider.label}
                        </div>
                        <div className="text-text-muted mt-0.5 text-[8px] font-black tracking-widest uppercase opacity-45">
                          {!provider.enabled
                            ? 'SUPPORTED'
                            : provider.status === 'ready'
                              ? 'ACTIVE'
                              : provider.status.replace('_', ' ')}
                        </div>
                      </div>
                    </div>

                    <Switch
                      checked={isActive}
                      onCheckedChange={(nextEnabled) => {
                        toggleProvider({ providerId: provider.id, enabled: nextEnabled });
                        if (nextEnabled && provider.status === 'inactive') {
                          activate(provider.id);
                        }
                      }}
                      size="sm"
                    />
                  </div>
                  {isActive && hasKeys && (
                    <div className="space-y-2 border-t border-border/10 pt-2.5">
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
                                  setLocalCustomEnvs({
                                    ...localCustomEnvs,
                                    [provider.id]: {
                                      ...(localCustomEnvs[provider.id] ?? {}),
                                      [key]: e.target.value,
                                    },
                                  });
                                }}
                                className={`!h-8 w-full !text-[11px] ${errorMsg ? 'border-danger/40 focus:border-danger/60' : ''}`}
                              />
                            </div>
                          );
                        })}
                        {hasChanges && (
                          <div className="flex justify-end pt-1">
                            <Button
                              onClick={() => {
                                updateProviderConfig({
                                  providerId: provider.id,
                                  customEnv: keysValues,
                                });
                              }}
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
            })
          )}
        </div>

        <div className="mt-4 text-center">
          <a
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              void markDone(defaultProviderId);
              void navigate('/settings');
            }}
            className="text-text-muted inline-flex items-center gap-1.5 text-[9px] font-black tracking-widest uppercase transition-colors hover:text-white"
          >
            <Terminal className="h-3 w-3" />
            ADVANCED_CONFIGURATION
          </a>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-border/10 pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              void markDone(defaultProviderId);
            }}
            className="h-9 px-4 text-[10px] font-bold tracking-widest"
          >
            SKIP
          </Button>
          <Button
            onClick={() => {
              void markDone(defaultProviderId);
            }}
            disabled={hasAnyInvalidProvider}
            className="h-9 px-4 text-[10px] font-bold tracking-widest"
          >
            INITIALIZATION_COMPLETE
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}
