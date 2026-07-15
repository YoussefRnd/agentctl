import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
  type MutationFunctionContext,
} from '@tanstack/react-query';
import { apiClient } from '@agentctl/api-client';
import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import { useActionDispatcher } from './useActionDispatcher';

type SessionResponse = SessionWithCapabilities;

export function useProviders(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { execute } = useActionDispatcher();

  const { data: providers = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: ['providers'],
    queryFn: () => apiClient.fetch<ProviderDiscovery[]>('/api/providers'),
  });

  const { data: registry = [], isLoading: isLoadingRegistry } = useQuery({
    queryKey: ['registry'],
    queryFn: () => apiClient.fetch<ProviderDiscovery[]>('/api/registry'),
  });

  const updateProviderMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: string; modelId?: string }) => {
      if (!sessionId) {
        throw new Error('No active session ID');
      }
      return apiClient.fetch(`/api/sessions/${sessionId}/provider`, {
        method: 'PATCH',
        body: JSON.stringify({ providerId, modelId }),
      });
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      }
    },
  });

  const switchProvider = (
    providerId: string,
    modelId?: string,
    sessionData?: SessionResponse | null,
  ) => {
    if (!sessionId) return;

    const capability = sessionData?.capabilities.find((item) => item.id === providerId);

    let selectedModel = modelId;
    if (!selectedModel) {
      const modelOption = capability?.configOptions?.find(
        (option) => option.id === 'model' || option.id === 'selectedModel',
      );
      selectedModel = modelOption?.currentValue ?? modelOption?.options[0]?.value ?? 'default';
    }

    void execute(`switch-provider-${providerId}`, () =>
      updateProviderMutation.mutateAsync({
        providerId,
        modelId: selectedModel,
      }),
    );
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
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch(`/api/providers/${providerId}/logout`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
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
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiClient.fetch<ProviderDiscovery[]>('/api/providers/sync', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/refresh`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/install`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/remove`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const updateProviderConfigMutation = useMutation({
    mutationFn: async ({
      providerId,
      customEnv,
      nativelyLoadsSkills,
    }: {
      providerId: string;
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
    }) => {
      return apiClient.fetch<ProviderDiscovery>(`/api/providers/${providerId}/config`, {
        method: 'POST',
        body: JSON.stringify({ customEnv, nativelyLoadsSkills }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const wrapMutate = <TParams, TResult>(
    actionName: string,
    mutation: ReturnType<typeof useMutation<TResult, Error, TParams>>,
    options: { successMessage?: string } = {},
  ) => {
    return (params: TParams, mutateOptions?: MutateOptions<TResult, Error, TParams>) => {
      void execute(actionName, () => mutation.mutateAsync(params), {
        successMessage: options.successMessage,
      }).then((result) => {
        if (result !== undefined) {
          mutateOptions?.onSuccess?.(
            result,
            params,
            undefined,
            {} as unknown as MutationFunctionContext,
          );
        } else {
          mutateOptions?.onError?.(
            new Error('Mutation failed'),
            params,
            undefined,
            {} as unknown as MutationFunctionContext,
          );
        }
      });
    };
  };

  return {
    providers,
    isLoadingProviders,
    registry,
    isLoadingRegistry,
    switchProvider,
    login: wrapMutate('login', loginMutation, { successMessage: 'Login successful' }),
    isLoggingIn: loginMutation.isPending,
    logoutProvider: wrapMutate('logout', logoutMutation, { successMessage: 'Logged out' }),
    isLoggingOut: logoutMutation.isPending,
    isSwitching: updateProviderMutation.isPending,
    activate: wrapMutate('activate', activateMutation, { successMessage: 'Provider activated' }),
    isActivating: activateMutation.isPending,
    syncProviders: wrapMutate('sync', syncMutation, { successMessage: 'Providers synced' }),
    isSyncing: syncMutation.isPending,
    refreshProvider: wrapMutate('refresh', refreshMutation, {
      successMessage: 'Provider refreshed',
    }),
    isRefreshing: refreshMutation.isPending,
    updateProviderConfig: wrapMutate('config', updateProviderConfigMutation, {
      successMessage: 'Configuration updated',
    }),
    isUpdatingConfig: updateProviderConfigMutation.isPending,
    installProvider: wrapMutate('install', installMutation, {
      successMessage: 'Provider installed',
    }),
    isInstalling: installMutation.isPending,
    installingProviderId: installMutation.isPending ? installMutation.variables : null,
    removeProvider: wrapMutate('remove', removeMutation, { successMessage: 'Provider removed' }),
    isRemoving: removeMutation.isPending,
    removingProviderId: removeMutation.isPending ? removeMutation.variables : null,
  };
}
