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
  const providersApi = useProviders(null, { includeRegistry: true });
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
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-text-main text-lg leading-8 font-bold">AI Providers</h2>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportDiagnostics()}
              disabled={isExportingDiagnostics}
              title="Exports connection state and capability decisions without prompts, environment variables, or protocol frames"
              className="border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50 flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap"
            >
              {isExportingDiagnostics ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
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
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 shrink-0 transition-transform duration-500 hover:rotate-180" />
              )}
              <span>Sync All</span>
            </Button>
          </div>
        </div>
        <p className="text-text-muted mt-1 text-xs">
          Configure agent providers, authentication keys, and model parameters. Installed provider
          packages update automatically in the background.
        </p>
      </div>

      <RegistryBrowser settings={settings} api={providersApi} />
    </div>
  );
}
