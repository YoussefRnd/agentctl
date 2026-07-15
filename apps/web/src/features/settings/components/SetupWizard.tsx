import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { Terminal, AlertOctagon } from 'lucide-react';
import { Card, Button, Switch, Select } from '@agentctl/ui';
import { ChecklistItem } from './SetupWizardChecklistItem';
import { SetupWizardProviderRow } from './SetupWizardProviderRow';

export function SetupWizard() {
  const { showWizard, markDone } = useSetupWizard();
  const { settings, updateSettings } = useSettings();
  const {
    providers,
    isLoadingProviders,
    updateProviderConfig,
    isUpdatingConfig,
  } = useProviders(null);
  const [localCustomEnvs, setLocalCustomEnvs] = useState<
    Record<string, Record<string, string> | undefined>
  >({});
  const [authDeferred, setAuthDeferred] = useState(false);

  const hasAnyInvalidProvider = providers.some((provider) => {
    if (provider.installState === 'not_installed') return false;
    const envKeys = getProviderEnvKeys(provider);
    return envKeys.some((key) => {
      const envs = localCustomEnvs[provider.id] ?? {};
      // `envs`/`provider.customEnv` index access can be undefined at runtime; the
      // lint rule misreads this index-signature value type as always defined.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const val = envs[key] ?? provider.customEnv[key] ?? '';
      return validateApiKey(key, val) !== null;
    });
  });

  if (!showWizard) return null;

  const enabledProviders = providers.filter((p) => p.installState !== 'not_installed');
  const registryOk = !settings?.registrySyncError && providers.length > 0;
  const atLeastOneEnabled = providers.some((p) => p.installState !== 'not_installed');
  const allEnabledReady = providers.every((p) => p.installState === 'not_installed' || p.authState === 'authenticated');
  const authOk = (allEnabledReady || authDeferred) && !hasAnyInvalidProvider;
  const defaultSelected =
    !!settings?.defaultProviderId &&
    !!providers.find((p) => p.id === settings.defaultProviderId && p.installState !== 'not_installed');

  const isReady = registryOk && atLeastOneEnabled && authOk && defaultSelected;

  const handleEnvChange = (providerId: string, key: string, value: string) => {
    setLocalCustomEnvs((prev) => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] ?? {}),
        [key]: value,
      },
    }));
  };

  const handleSaveConfig = (providerId: string, customEnv: Record<string, string>) => {
    updateProviderConfig({ providerId, customEnv });
  };

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

        {settings?.registrySyncError && (
          <div className="bg-danger/10 border-danger/25 animate-in fade-in space-y-2 rounded-xl border p-3.5 text-left">
            <div className="text-danger flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase">
              <AlertOctagon className="h-4 w-4" />
              Registry Sync Failure
            </div>
            <div className="text-text-main/90 font-mono text-[9.5px] leading-relaxed font-bold uppercase">
              {settings.registrySyncError}
            </div>
          </div>
        )}

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
            <ChecklistItem label="At Least One Agent Enabled" checked={atLeastOneEnabled} />
            <ChecklistItem
              label="Authentication Resolved"
              checked={authOk}
              warning={!allEnabledReady && authDeferred ? 'Deferred' : undefined}
            />
            <ChecklistItem label="Default Agent Selected" checked={defaultSelected} />
          </ul>
        </div>

        {providers.some((p) => p.installState !== 'not_installed' && p.authState === 'needs_auth') && (
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
            providers.map((provider) => (
              <SetupWizardProviderRow
                key={provider.id}
                provider={provider}
                localCustomEnvs={localCustomEnvs}
                onEnvChange={handleEnvChange}
                onSaveConfig={handleSaveConfig}
                isUpdatingConfig={isUpdatingConfig}
              />
            ))
          )}
        </div>

        <div className="pt-2 text-center">
          <Link
            to="/settings"
            onClick={() => {
              void markDone();
            }}
            className="text-text-muted inline-flex items-center gap-1.5 label-3xs transition-colors hover:text-white"
          >
            <Terminal className="h-3 w-3" />
            ADVANCED_CONFIGURATION
          </Link>
        </div>

        <div className="border-border/10 flex justify-end gap-2 border-t pt-4">
          <Button
            onClick={() => {
              void markDone();
            }}
            disabled={!isReady}
            className="h-9 w-full px-4 label-2xs"
          >
            INITIALIZATION_COMPLETE
          </Button>
        </div>
      </Card>
    </div>
  );
}
