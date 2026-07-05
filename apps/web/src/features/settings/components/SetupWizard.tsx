import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { Bot, Terminal, Check, AlertTriangle, AlertOctagon } from 'lucide-react';
import { Card, Button, Input, Switch, Select } from '@agentctl/ui';

function ChecklistItem({
  label,
  checked,
  error,
  warning,
}: {
  label: string;
  checked: boolean;
  error?: string;
  warning?: string;
}) {
  return (
    <li className="flex items-start justify-between text-[10px] font-bold tracking-tight uppercase select-none">
      <span className={error ? 'text-danger' : checked ? 'text-text-main' : 'text-text-muted/60'}>
        {label}
        {error && (
          <span className="text-danger/80 mt-0.5 block text-[8px] font-medium lowercase italic">
            {error}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[9px] font-black">
        {error ? (
          <span className="text-danger flex items-center gap-1">
            <AlertOctagon className="text-danger h-3.5 w-3.5" /> [FAIL]
          </span>
        ) : checked ? (
          <span className="text-success flex items-center gap-1">
            <Check className="text-success h-3.5 w-3.5" /> [PASS]
          </span>
        ) : warning ? (
          <span className="text-warning flex items-center gap-1">
            <AlertTriangle className="text-warning h-3.5 w-3.5" /> [{warning}]
          </span>
        ) : (
          <span className="text-text-muted/40">[PENDING]</span>
        )}
      </span>
    </li>
  );
}

export function SetupWizard() {
  const { showWizard, markDone } = useSetupWizard();
  const { settings, updateSettings } = useSettings();
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
  const [authDeferred, setAuthDeferred] = useState(false);

  const hasAnyInvalidProvider = providers.some((provider) => {
    if (!provider.enabled) return false;
    const envKeys = getProviderEnvKeys(provider);
    return envKeys.some((key) => {
      const val = localCustomEnvs[provider.id]?.[key] ?? (provider.customEnv[key] || '');
      return validateApiKey(key, val) !== null;
    });
  });

  if (!showWizard) return null;

  const enabledProviders = providers.filter((p) => p.enabled);
  const registryOk = !settings?.registrySyncError && providers.length > 0;
  const allowedAgentsOk = !settings?.registrySyncError && providers.length > 0;
  const atLeastOneEnabled = providers.some((p) => p.enabled);
  const allEnabledReady = providers.every((p) => !p.enabled || p.status === 'ready');
  const authOk = (allEnabledReady || authDeferred) && !hasAnyInvalidProvider;
  const defaultSelected =
    !!settings?.defaultProviderId &&
    !!providers.find((p) => p.id === settings.defaultProviderId)?.enabled;

  const isReady = registryOk && allowedAgentsOk && atLeastOneEnabled && authOk && defaultSelected;

  return (
    <div className="bg-background/85 fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md">
      <Card
        intensity="high"
        className="relative z-10 flex w-full max-w-lg flex-col space-y-4 rounded-3xl p-6 shadow-2xl"
      >
        <div className="text-center">
          <h1 className="text-text-main text-lg font-black tracking-widest uppercase">
            INITIAL_SETUP::AI_PIPELINE
          </h1>
          <p className="text-text-muted mt-1 text-[9px] font-bold tracking-widest uppercase opacity-60">
            Readiness Checklist and Configuration
          </p>
        </div>

        {/* Sync Failure Error Card */}
        {settings?.registrySyncError && (
          <div className="bg-danger/10 border-danger/25 animate-in fade-in space-y-2 rounded-xl border p-3.5 text-left">
            <div className="text-danger flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase">
              <AlertOctagon className="h-4 w-4" />
              Registry Sync Failure
            </div>
            <div className="text-text-main/90 font-mono text-[9.5px] leading-relaxed font-bold uppercase">
              {settings.registrySyncError}
            </div>
            {settings.registrySyncError.includes('ALLOWED_AGENTS') && (
              <div className="text-text-muted/65 text-[8.5px] leading-normal font-medium lowercase">
                * tip: make sure you have defined ALLOWED_AGENTS in your .env or server environment
                variables (e.g. ALLOWED_AGENTS=claude-acp,gemini,opencode) and restart the server.
              </div>
            )}
          </div>
        )}

        {/* Readiness Checklist */}
        <div className="bg-surface-secondary/15 border-border/10 space-y-3 rounded-2xl border p-4">
          <h3 className="text-text-main text-[9.5px] font-black tracking-widest uppercase opacity-85">
            Readiness Checklist
          </h3>
          <ul className="space-y-2.5">
            <ChecklistItem
              label="Agent Registry Synced"
              checked={registryOk}
              error={settings?.registrySyncError ? 'Registry sync failed' : undefined}
            />
            <ChecklistItem
              label="ALLOWED_AGENTS Configured"
              checked={allowedAgentsOk}
              error={
                settings?.registrySyncError?.includes('ALLOWED_AGENTS')
                  ? 'ALLOWED_AGENTS missing in environment'
                  : undefined
              }
            />
            <ChecklistItem label="At Least One Agent Enabled" checked={atLeastOneEnabled} />
            <ChecklistItem
              label="Authentication Resolved"
              checked={authOk}
              warning={!allEnabledReady && authDeferred ? 'Deferred' : undefined}
            />
            <ChecklistItem label="Default Agent Selected" checked={defaultSelected} />
          </ul>
        </div>

        {/* Defer Authentication Toggle */}
        {providers.some((p) => p.enabled && p.status === 'needs_auth') && (
          <div className="bg-surface-secondary/10 border-border/10 flex items-center gap-3 rounded-xl border p-3 select-none">
            <Switch id="deferAuth" checked={authDeferred} onCheckedChange={setAuthDeferred} />
            <label
              htmlFor="deferAuth"
              className="text-text-main cursor-pointer text-[9.5px] font-bold tracking-wide uppercase"
            >
              Defer authentication for now (I will configure API keys later)
            </label>
          </div>
        )}

        {/* Default Provider Selector */}
        {enabledProviders.length > 0 && (
          <div className="bg-surface-secondary/10 border-border/10 space-y-1.5 rounded-xl border p-3.5">
            <label
              htmlFor="defaultProvider"
              className="text-text-muted text-[8px] font-black tracking-widest uppercase"
            >
              Default Provider
            </label>
            <Select
              value={settings?.defaultProviderId ?? ''}
              onChange={(value) => {
                void updateSettings({ defaultProviderId: value });
              }}
              options={enabledProviders.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
              placeholder="Select default provider..."
              triggerClassName="h-8 rounded-lg"
            />
          </div>
        )}

        {/* Providers List */}
        <div className="custom-scrollbar max-h-[220px] flex-1 space-y-2 overflow-y-auto py-1 pr-1">
          {isLoadingProviders ? (
            <div className="animate-pulse space-y-1.5">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="bg-surface-secondary/40 border-border/20 h-12 rounded-xl border"
                />
              ))}
            </div>
          ) : (
            providers.map((provider) => {
              const isActive = provider.enabled;
              const envKeys = getProviderEnvKeys(provider);
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
                  className="bg-surface-secondary/20 border-border/10 hover:border-border/30 animate-in fade-in flex flex-col gap-2.5 rounded-xl border p-3 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="bg-background border-border/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border p-1">
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

        <div className="pt-2 text-center">
          <Link
            to="/settings"
            onClick={() => {
              void markDone();
            }}
            className="text-text-muted inline-flex items-center gap-1.5 text-[9px] font-black tracking-widest uppercase transition-colors hover:text-white"
          >
            <Terminal className="h-3 w-3" />
            ADVANCED_CONFIGURATION
          </Link>
        </div>

        {/* Buttons Panel */}
        <div className="border-border/10 flex justify-end gap-2 border-t pt-4">
          <Button
            onClick={() => {
              void markDone();
            }}
            disabled={!isReady}
            className="h-9 w-full px-4 text-[10px] font-black tracking-widest uppercase"
          >
            INITIALIZATION_COMPLETE
          </Button>
        </div>
      </Card>
    </div>
  );
}
