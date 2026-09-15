import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@agentctl/api-client';
import { type FontConfig } from '@agentctl/shared';
import { settingsKeys } from '@/shared/lib/queryKeys';

export interface SystemSettings {
  onboardingCompleted: boolean;
  onboardingVersion: string | number;
  setupStep: string | null;
  defaultProviderId: string | null;
  showThinking: boolean;
  registrySyncError: string | null;
  fontConfig?: FontConfig;
}

export function useSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<SystemSettings>({
    queryKey: settingsKeys.all,
    queryFn: () => apiClient.fetch<SystemSettings>('/api/settings'),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (payload: Partial<SystemSettings>) => {
      return apiClient.fetch<SystemSettings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.all, data);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update settings');
    },
  });

  return {
    settings,
    isLoading,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
  };
}
