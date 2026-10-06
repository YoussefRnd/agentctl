import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
  type MutationFunctionContext,
} from '@tanstack/react-query';
import { providerService } from '@agentctl/api-client';
import { findAgentConfigOption, type SessionWithCapabilities } from '@agentctl/shared';
import { providerKeys, sessionKeys } from '../../../shared/lib/queryKeys.js';
import { useActionDispatcher } from '@/shared/hooks/useActionDispatcher';

type SessionResponse = SessionWithCapabilities;

export function useProviders(
  sessionId: string | null,
  { includeRegistry = false }: { includeRegistry?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const { execute } = useActionDispatcher();

  const {
    data: providers = [],
    isLoading: isLoadingProviders,
    error: providersError,
    refetch: retryProviders,
  } = useQuery({
    queryKey: providerKeys.all,
    queryFn: () => providerService.getProviders(),
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });

  const {
    data: registry = [],
    isLoading: isLoadingRegistry,
    error: registryError,
    refetch: retryRegistry,
  } = useQuery({
    queryKey: providerKeys.registry,
    queryFn: () => providerService.getRegistry(),
    enabled: includeRegistry,
    // Only the provider settings view needs catalog data. The server returns
    // its cached catalog; Sync All performs an explicit remote refresh.
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const invalidateProviderCaches = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: providerKeys.all });
    void queryClient.invalidateQueries({ queryKey: providerKeys.registry });
    if (sessionId) {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    }
  }, [queryClient, sessionId]);

  const updateProviderMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: string; modelId?: string }) => {
      if (!sessionId) {
        throw new Error('No active session ID');
      }
      return providerService.updateSessionProvider(sessionId, providerId, modelId);
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
      }
    },
  });

  const switchProvider = useCallback(
    (providerId: string, modelId?: string, sessionData?: SessionResponse | null) => {
      if (!sessionId) return;

      const capability = sessionData?.capabilities.find((item) => item.id === providerId);

      let selectedModel = modelId;
      if (!selectedModel) {
        const modelOption = findAgentConfigOption(capability?.configOptions, 'model');
        selectedModel =
          capability?.defaultModel ??
          (typeof modelOption?.currentValue === 'string'
            ? modelOption.currentValue
            : modelOption?.options?.[0]?.value) ??
          'default';
      }

      void execute(`switch-provider-${providerId}`, () =>
        updateProviderMutation.mutateAsync({
          providerId,
          modelId: selectedModel,
        }),
      );
    },
    [sessionId, execute, updateProviderMutation],
  );

  const loginMutation = useMutation({
    mutationFn: async ({ providerId, methodId }: { providerId: string; methodId: string }) => {
      return providerService.login(providerId, methodId);
    },
    onSettled: invalidateProviderCaches,
  });

  const logoutMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.logout(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const activateMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.activate(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return providerService.sync();
    },
    onSettled: invalidateProviderCaches,
  });

  const refreshMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.refresh(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const installMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.install(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const cancelInstallMutation = useMutation({
    mutationFn: async (providerId: string) => providerService.cancelInstall(providerId),
    onSettled: invalidateProviderCaches,
  });

  const removeMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.remove(providerId);
    },
    onSettled: invalidateProviderCaches,
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
      return providerService.updateConfig(providerId, customEnv, nativelyLoadsSkills);
    },
    onSettled: invalidateProviderCaches,
  });

  const wrapMutate = useCallback(
    <TParams, TResult>(
      actionName: string,
      mutation: { mutateAsync: (params: TParams) => Promise<TResult> },
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
    },
    [execute],
  );

  const login = useMemo(
    () => wrapMutate('login', loginMutation, { successMessage: 'Login successful' }),
    [wrapMutate, loginMutation],
  );
  const logoutProvider = useMemo(
    () => wrapMutate('logout', logoutMutation, { successMessage: 'Logged out' }),
    [wrapMutate, logoutMutation],
  );
  const activate = useMemo(
    () => wrapMutate('activate', activateMutation, { successMessage: 'Provider activated' }),
    [wrapMutate, activateMutation],
  );
  const syncProviders = useMemo(
    () => wrapMutate('sync', syncMutation, { successMessage: 'Providers synced' }),
    [wrapMutate, syncMutation],
  );
  const refreshProvider = useMemo(
    () => wrapMutate('refresh', refreshMutation, { successMessage: 'Provider refreshed' }),
    [wrapMutate, refreshMutation],
  );
  const cancelLoginMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.cancelLogin(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const verifyMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.verify(providerId);
    },
    onSettled: invalidateProviderCaches,
  });

  const updateProviderConfig = useMemo(
    () =>
      wrapMutate('config', updateProviderConfigMutation, {
        successMessage: 'Configuration updated',
      }),
    [wrapMutate, updateProviderConfigMutation],
  );
  const updateProviderConfigAsync = useCallback(
    (params: {
      providerId: string;
      customEnv?: Record<string, string>;
      nativelyLoadsSkills?: boolean;
    }) => updateProviderConfigMutation.mutateAsync(params),
    [updateProviderConfigMutation],
  );
  const cancelLogin = useMemo(
    () => wrapMutate('cancelLogin', cancelLoginMutation),
    [wrapMutate, cancelLoginMutation],
  );
  const verifyProvider = useMemo(
    () => wrapMutate('verify', verifyMutation, { successMessage: 'Verification successful' }),
    [wrapMutate, verifyMutation],
  );
  const installProvider = useMemo(
    () => wrapMutate('install', installMutation),
    [wrapMutate, installMutation],
  );
  const cancelInstall = useMemo(
    () => wrapMutate('cancelInstall', cancelInstallMutation),
    [wrapMutate, cancelInstallMutation],
  );
  const removeProvider = useMemo(
    () => wrapMutate('remove', removeMutation, { successMessage: 'Provider removed' }),
    [wrapMutate, removeMutation],
  );

  return {
    providers,
    isLoadingProviders,
    providersError,
    retryProviders,
    registry,
    isLoadingRegistry,
    registryError,
    retryRegistry,
    switchProvider,
    login,
    isLoggingIn: loginMutation.isPending,
    authenticatingProviderId: loginMutation.isPending ? loginMutation.variables?.providerId : null,
    cancelLogin,
    verifyProvider,
    isVerifying: verifyMutation.isPending,
    verifyingProviderId: verifyMutation.isPending ? verifyMutation.variables : null,
    logoutProvider,
    isLoggingOut: logoutMutation.isPending,
    isSwitching: updateProviderMutation.isPending,
    activate,
    isActivating: activateMutation.isPending,
    syncProviders,
    isSyncing: syncMutation.isPending,
    refreshProvider,
    isRefreshing: refreshMutation.isPending,
    updateProviderConfig,
    updateProviderConfigAsync,
    isUpdatingConfig: updateProviderConfigMutation.isPending,
    installProvider,
    cancelInstall,
    isInstalling: installMutation.isPending,
    installingProviderId: installMutation.isPending ? installMutation.variables : null,
    removeProvider,
    isRemoving: removeMutation.isPending,
    removingProviderId: removeMutation.isPending ? removeMutation.variables : null,
  };
}
