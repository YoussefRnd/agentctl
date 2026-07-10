import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@agentctl/api-client';
import { type FontConfig } from '@agentctl/shared';

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
    queryKey: ['settings'],
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
      queryClient.setQueryData(['settings'], data);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update settings');
    },
  });

  useEffect(() => {
    if (!settings?.fontConfig) return;
    const fc = settings.fontConfig;
    const root = document.documentElement;
    const props: [string, string][] = [
      ['--font-ui-family',       fc.ui.family],
      ['--font-ui-size',         `${String(fc.ui.size)}px`],
      ['--font-buffer-family',   fc.buffer.family],
      ['--font-buffer-size',     `${String(fc.buffer.size)}px`],
      ['--font-terminal-family', fc.terminal.family],
      ['--font-terminal-size',   `${String(fc.terminal.size)}px`],
      ['--font-chat-family',     fc.chat.family],
      ['--font-chat-size',       `${String(fc.chat.size)}px`],
    ];
    for (const [prop, val] of props) {
      root.style.setProperty(prop, val);
    }
    return () => {
      for (const [prop] of props) {
        root.style.removeProperty(prop);
      }
    };
  }, [settings?.fontConfig]);

  return {
    settings,
    isLoading,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending,
  };
}
