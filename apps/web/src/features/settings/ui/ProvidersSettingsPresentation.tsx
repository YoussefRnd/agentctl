import { SettingsListLayout } from './SettingsListLayouts';
import type { useProviders } from '@/features/providers';
import type { useSettings } from '../api/useSettings';
import { Button, ErrorState, Spinner } from '@agentctl/ui';
import { Download, RefreshCw } from 'lucide-react';
import { ProviderProfilesPresentation } from './ProviderProfilesPanel';
import { RegistryBrowserPresentation } from './RegistryBrowser';

export function ProvidersSettingsPresentation({
  settings,
  providersApi,
  isExportingDiagnostics = false,
  exportDiagnostics,
  invalidateProfiles,
}: {
  settings: ReturnType<typeof useSettings>['settings'];
  providersApi: Pick<
    ReturnType<typeof useProviders>,
    | 'providers'
    | 'registry'
    | 'isLoadingProviders'
    | 'isLoadingRegistry'
    | 'syncProviders'
    | 'isSyncing'
    | 'installProvider'
    | 'cancelInstall'
    | 'isInstalling'
    | 'installingProviderId'
    | 'removeProvider'
    | 'isRemoving'
    | 'removingProviderId'
    | 'logoutProvider'
    | 'updateProviderConfig'
    | 'isUpdatingConfig'
    | 'login'
    | 'isLoggingIn'
    | 'refreshProvider'
    | 'isRefreshing'
    | 'providersError'
    | 'registryError'
  > & { retryProviders: () => unknown; retryRegistry: () => unknown };
  isExportingDiagnostics?: boolean;
  exportDiagnostics: () => Promise<void>;
  invalidateProfiles: () => Promise<void>;
}) {
  return (
    <SettingsListLayout
      section="providers"
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportDiagnostics()}
            disabled={isExportingDiagnostics}
            title="Exports connection state and capability decisions without prompts, environment variables, or protocol frames"
            className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap"
          >
            {isExportingDiagnostics ? (
              <Spinner aria-hidden="true" className="icon-compact shrink-0" />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>Export diagnostics</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              providersApi.syncProviders();
            }}
            disabled={providersApi.isSyncing}
            className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap"
          >
            {providersApi.isSyncing ? (
              <Spinner aria-hidden="true" className="icon-compact shrink-0" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 shrink-0 transition-transform duration-500 hover:rotate-180" />
            )}
            <span>Sync All</span>
          </Button>
        </>
      }
    >
      {/* Header */}
      {providersApi.providersError && (
        <ErrorState
          title="Could not load agents"
          message={providersApi.providersError.message}
          onRetry={() => void providersApi.retryProviders()}
        />
      )}
      {providersApi.registryError && (
        <ErrorState
          title="Could not load agent catalog"
          message={providersApi.registryError.message}
          onRetry={() => void providersApi.retryRegistry()}
        />
      )}
      <ProviderProfilesPresentation
        providers={providersApi.providers}
        invalidate={invalidateProfiles}
      />
      <RegistryBrowserPresentation settings={settings} api={providersApi} />
    </SettingsListLayout>
  );
}
