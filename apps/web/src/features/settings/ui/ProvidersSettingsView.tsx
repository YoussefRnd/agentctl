import { useState } from 'react';
import { useProviders } from '@/features/providers';
import { useSettings } from '../api/useSettings';
import { Button } from '@agentctl/ui';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { RegistryBrowser } from './RegistryBrowser';
import { providerService } from '@agentctl/api-client';
import { toast } from 'sonner';

export function ProvidersSettingsView() {
  const { settings } = useSettings();
  const providersApi = useProviders(null);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);

  const exportDiagnostics = async () => {
    setIsExportingDiagnostics(true);
    try {
      const diagnostics = await providerService.getTransportDiagnostics();
      const blob = new Blob([JSON.stringify(diagnostics, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agentctl-transport-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Transport diagnostics exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export diagnostics');
    } finally {
      setIsExportingDiagnostics(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void exportDiagnostics()}
            disabled={isExportingDiagnostics}
            title="Exports connection state and capability decisions without prompts, environment variables, or protocol frames"
            className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
          >
            {isExportingDiagnostics ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Export diagnostics
          </Button>
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
      </div>

      <RegistryBrowser settings={settings} api={providersApi} />
    </div>
  );
}
