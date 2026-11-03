import { ProvidersSettingsPresentation } from './ProvidersSettingsPresentation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { providerKeys } from '@/shared/lib/queryKeys';
import { useProviders } from '@/features/providers';
import { useSettings } from '../api/useSettings';
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

  const synced = useRef(false);
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    providersApi.syncProviders();
  }, [providersApi.syncProviders]);
  const queryClient = useQueryClient();
  return (
    <ProvidersSettingsPresentation
      settings={settings}
      providersApi={providersApi}
      isExportingDiagnostics={isExportingDiagnostics}
      exportDiagnostics={exportDiagnostics}
      invalidateProfiles={async () => {
        await queryClient.invalidateQueries({ queryKey: providerKeys.all });
        await queryClient.invalidateQueries({ queryKey: providerKeys.registry });
      }}
    />
  );
}
