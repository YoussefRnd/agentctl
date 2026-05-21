import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@agentctl/api-client';
import type {
  DriverDiscovery,
  DriverName,
  SessionProviderSelection,
  SessionWithCapabilities,
  ThinkingEffort,
} from '@agentctl/shared';

type SessionResponse = SessionWithCapabilities;

export function useDrivers(sessionId: string | null) {
  const queryClient = useQueryClient();

  const { data: drivers = [], isLoading: isLoadingDrivers } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const providerMutation = useMutation({
    mutationFn: (payload: SessionProviderSelection) => {
      if (!sessionId) throw new Error('No active session');
      return apiClient.fetch<SessionResponse>(`/api/sessions/${sessionId}/provider`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data) => {
      if (sessionId) {
        queryClient.setQueryData<SessionResponse>(['session', sessionId], data);
      }
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to switch provider');
    },
  });

  const switchProvider = (
    driverId: string,
    modelId?: string,
    sessionData?: SessionResponse | null,
  ) => {
    const capability = sessionData?.capabilities.find((item) => item.id === driverId);

    // If a model is explicitly passed, use it. Otherwise, fallback to the current/default.
    let selectedModel = modelId;
    if (!selectedModel) {
      const modelOption = capability?.configOptions?.find(
        (option) => option.id === 'model' || option.id === 'selectedModel',
      );
      selectedModel = modelOption?.currentValue ?? modelOption?.options[0]?.value ?? 'default';
    }

    const thinkingOption = capability?.configOptions?.find(
      (option) =>
        option.id === 'thinking' ||
        option.id === 'thinking_effort' ||
        option.id === 'selectedThinkingEffort',
    );

    providerMutation.mutate({
      selectedDriver: driverId as DriverName,
      selectedModel: selectedModel,
      selectedThinkingEffort: (thinkingOption?.currentValue ??
        thinkingOption?.options[0]?.value ??
        'medium') as ThinkingEffort,
    });
  };

  const loginMutation = useMutation({
    mutationFn: async ({ driverId, methodId }: { driverId: string; methodId: string }) => {
      return apiClient.fetch(`/api/drivers/${driverId}/login`, {
        method: 'POST',
        body: JSON.stringify({ methodId }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Login initiated. Please check your browser or terminal.');
    },
    onError: (err) => {
      toast.error(`Login failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return apiClient.fetch(`/api/drivers/${driverId}/activate`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Agent activated successfully!');
    },
    onError: (err) => {
      toast.error(`Activation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiClient.fetch<DriverDiscovery[]>('/api/drivers/sync', {
        method: 'POST',
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['drivers'], data);
      toast.success('Agents synced successfully!');
    },
    onError: (err) => {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ driverId, enabled }: { driverId: string; enabled: boolean }) => {
      return apiClient.fetch<DriverDiscovery>(`/api/drivers/${driverId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Driver selection updated successfully.');
    },
    onError: (err) => {
      toast.error(`Toggle failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  return {
    drivers,
    isLoadingDrivers,
    switchProvider,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    isSwitching: providerMutation.isPending,
    activate: activateMutation.mutate,
    isActivating: activateMutation.isPending,
    syncDrivers: syncMutation.mutate,
    isSyncing: syncMutation.isPending,
    toggleDriver: toggleMutation.mutate,
    isToggling: toggleMutation.isPending,
  };
}
