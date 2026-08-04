import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetupWizard } from '../hooks/useSetupWizard';
import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import { Terminal, AlertOctagon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Switch,
  Select,
} from '@agentctl/ui';
import { ChecklistItem } from './SetupWizardChecklistItem';
import { SetupWizardProviderRow } from './SetupWizardProviderRow';

function readCustomEnv(env: Record<string, string> | undefined, key: string): string | undefined {
  return env?.[key];
}

export function SetupWizard() {
  const { showWizard, markDone } = useSetupWizard();
  const { settings, updateSettings } = useSettings();
  const { providers, isLoadingProviders, updateProviderConfig, isUpdatingConfig } =
    useProviders(null);
  const [localCustomEnvs, setLocalCustomEnvs] = useState<
    Record<string, Record<string, string> | undefined>
  >({});
  const [authDeferred, setAuthDeferred] = useState(false);

  const hasAnyInvalidProvider = providers.some((provider) => {
    if (provider.installState === 'not_installed') return false;
    const envKeys = getProviderEnvKeys(provider);
    return envKeys.some((key) => {
      const val =
        readCustomEnv(localCustomEnvs[provider.id], key) ??
        readCustomEnv(provider.customEnv, key) ??
        '';
      return validateApiKey(key, val) !== null;
    });
  });

  if (!showWizard) return null;

  const enabledProviders = providers.filter((p) => p.installState !== 'not_installed');
  const registryOk = !settings?.registrySyncError && providers.length > 0;
  const atLeastOneEnabled = providers.some((p) => p.installState !== 'not_installed');
  const allEnabledReady = providers.every(
    (p) => p.installState === 'not_installed' || p.authState === 'authenticated',
  );
  const authOk = (allEnabledReady || authDeferred) && !hasAnyInvalidProvider;
  const defaultSelected =
    !!settings?.defaultProviderId &&
    !!providers.find(
      (p) => p.id === settings.defaultProviderId && p.installState !== 'not_installed',
    );

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
    <Dialog
      open={showWizard}
      onOpenChange={(open) => {
        if (!open) {
          void markDone();
        }
      }}
    >
      <DialogContent showCloseButton={true} className="max-w-lg rounded-2xl p-6 shadow-2xl">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-text-main text-lg font-semibold">
            Initial setup: AI pipeline
          </DialogTitle>
          <DialogDescription className="text-text-muted mt-1 text-xs opacity-70">
            Readiness checklist and configuration
          </DialogDescription>
        </DialogHeader>

        {settings?.registrySyncError && (
          <div className="bg-danger/10 border-danger/25 animate-in fade-in space-y-2 rounded-xl border p-3.5 text-left">
            <div className="text-danger flex items-center gap-1.5 text-xs font-semibold">
              <AlertOctagon className="h-4 w-4" />
              Registry sync failure
            </div>
            <div className="text-text-main/90 font-mono text-xs leading-relaxed">
              {settings.registrySyncError}
            </div>
          </div>
        )}

        <div className="bg-surface-secondary/15 border-border/10 space-y-3 rounded-2xl border p-4">
          <h3 className="text-text-main text-xs font-semibold opacity-90">Readiness checklist</h3>
          <ul className="space-y-2.5">
            <ChecklistItem
              label="Agent registry synced"
              checked={registryOk}
              error={settings?.registrySyncError ? 'Registry sync failed' : undefined}
            />
            <ChecklistItem label="At least one agent enabled" checked={atLeastOneEnabled} />
            <ChecklistItem
              label="Authentication resolved"
              checked={authOk}
              warning={!allEnabledReady && authDeferred ? 'Deferred' : undefined}
            />
            <ChecklistItem label="Default agent selected" checked={defaultSelected} />
          </ul>
        </div>

        {providers.some(
          (p) => p.installState !== 'not_installed' && p.authState === 'needs_auth',
        ) && (
          <div className="bg-surface-secondary/10 border-border/10 flex items-center gap-3 rounded-xl border p-3 select-none">
            <Switch id="deferAuth" checked={authDeferred} onCheckedChange={setAuthDeferred} />
            <label
              htmlFor="deferAuth"
              className="text-text-main cursor-pointer text-xs font-medium"
            >
              Defer authentication for now (I will configure API keys later)
            </label>
          </div>
        )}

        {enabledProviders.length > 0 && (
          <div className="bg-surface-secondary/10 border-border/10 space-y-1.5 rounded-xl border p-3.5">
            <label htmlFor="defaultProvider" className="text-text-muted text-xs font-medium">
              Default provider
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
            className="text-text-muted inline-flex items-center gap-1.5 text-xs transition-colors hover:text-white"
          >
            <Terminal className="h-3 w-3" />
            Advanced configuration
          </Link>
        </div>

        <div className="border-border/10 flex justify-end gap-2 border-t pt-4">
          <Button
            variant="ghost"
            onClick={() => {
              void markDone();
            }}
            className="text-text-muted hover:text-text-main h-9 px-4 text-xs font-medium"
          >
            Skip for now
          </Button>
          <Button
            onClick={() => {
              void markDone();
            }}
            disabled={!isReady}
            className="bg-accent text-brand-crust h-9 flex-1 px-4 text-xs font-medium hover:opacity-90"
          >
            Complete setup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
