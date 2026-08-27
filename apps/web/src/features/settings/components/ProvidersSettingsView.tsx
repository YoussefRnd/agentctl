import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';
import { Button } from '@agentctl/ui';
import { Loader2, RefreshCw } from 'lucide-react';
import { RegistryBrowser } from './RegistryBrowser';

export function ProvidersSettingsView() {
  const { settings } = useSettings();
  const providersApi = useProviders(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pr-10">
        <div>
          <h2 className="text-text-main text-lg font-bold">AI Providers</h2>
          <p className="text-text-muted mt-0.5 text-xs">
            Configure agent providers, authentication keys, and model parameters.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            providersApi.syncProviders();
          }}
          disabled={providersApi.isSyncing}
          className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
        >
          {providersApi.isSyncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 transition-transform duration-500 hover:rotate-180" />
          )}
          Sync All
        </Button>
      </div>

      <RegistryBrowser settings={settings} api={providersApi} />
    </div>
  );
}
