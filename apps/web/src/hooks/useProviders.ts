import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@agentctl/api-client';
import type {
  ProviderDiscovery,
  ProviderName,
  SessionProviderSelection,
  SessionWithCapabilities,
  ThinkingEffort,
} from '@agentctl/shared';

type SessionResponse = SessionWithCapabilities;

export function useProviders(sessionId: string | null) {
  const queryClient = useQueryClient();

  const { data: providers = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiClient.fetch<ProviderDiscovery[]>('/api/providers'),
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
  });

  const switchProvider = (
    providerId: string,
    modelId?: string,
    sessionData?: SessionResponse | null,
  ) => {
    const capability = sessionData?.capabilities.find((item) => item.id === providerId);

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
      selectedProvider: providerId as ProviderName,
      selectedModel: selectedModel,
      selectedThinkingEffort: (thinkingOption?.currentValue ??
        thinkingOption?.options[0]?.value ??
        'medium') as ThinkingEffort,
    });
  };

  const loginMutation = useMutation({
    mutationFn: async ({ providerId, methodId }: { providerId: string; methodId: string }) => {
      return apiClient.fetch(`/api/providers/${providerId}/login`, {
        method: 'POST',
        body: JSON.stringify({ methodId }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch(`/api/providers/${providerId}/activate`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiClient.fetch<ProviderDiscovery[]>('/api/providers/sync', {
        method: 'POST',
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['providers'], data);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ providerId, enabled }: { providerId: string; enabled: boolean }) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/refresh`, {
        method: 'POST',
      });
    },
    onSuccess: (updatedProvider) => {
      queryClient.setQueryData<ProviderDiscovery[]>(['providers'], (current = []) =>
        current.map((p) => (p.id === updatedProvider.id ? updatedProvider : p)),
      );
    },
  });

  const updateProviderConfigMutation = useMutation({
    mutationFn: async ({
      providerId,
      customEnv,
    }: {
      providerId: string;
      customEnv: Record<string, string>;
    }) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/config`, {
        method: 'POST',
        body: JSON.stringify({ customEnv }),
      });
    },
    onSuccess: (updatedProvider) => {
      queryClient.setQueryData<ProviderDiscovery[]>(['providers'], (current = []) =>
        current.map((p) => (p.id === updatedProvider.id ? updatedProvider : p)),
      );
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  return {
    providers,
    isLoadingProviders,
    switchProvider,
    login: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    isSwitching: providerMutation.isPending,
    activate: activateMutation.mutate,
    isActivating: activateMutation.isPending,
    syncProviders: syncMutation.mutate,
    isSyncing: syncMutation.isPending,
    toggleProvider: toggleMutation.mutate,
    isToggling: toggleMutation.isPending,
    refreshProvider: refreshMutation.mutate,
    isRefreshing: refreshMutation.isPending,
    updateProviderConfig: updateProviderConfigMutation.mutate,
    isUpdatingConfig: updateProviderConfigMutation.isPending,
  };
}

