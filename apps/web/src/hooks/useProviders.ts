import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
  type MutationFunctionContext,
} from '@tanstack/react-query';
import { providerService } from '@agentctl/api-client';
import type { SessionWithCapabilities } from '@agentctl/shared';
import { useActionDispatcher } from './useActionDispatcher';

type SessionResponse = SessionWithCapabilities;

export function useProviders(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { execute } = useActionDispatcher();

  const { data: providers = [], isLoading: isLoadingProviders } = useQuery({
    queryKey: ['providers'],
    queryFn: () => providerService.getProviders(),
  });

  const { data: registry = [], isLoading: isLoadingRegistry } = useQuery({
    queryKey: ['registry'],
    queryFn: () => providerService.getRegistry(),
  });

  const updateProviderMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: string; modelId?: string }) => {
      if (!sessionId) {
        throw new Error('No active session ID');
      }
      return providerService.updateSessionProvider(sessionId, providerId, modelId);
    },
    onSuccess: () => {
      if (sessionId) {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      }
    },
  });

  const switchProvider = useCallback(
    (providerId: string, modelId?: string, sessionData?: SessionResponse | null) => {
      if (!sessionId) return;

      const capability = sessionData?.capabilities.find((item) => item.id === providerId);

      let selectedModel = modelId;
      if (!selectedModel) {
        const modelOption = capability?.configOptions?.find(
          (option) => option.id === 'model' || option.id === 'selectedModel',
        );
        selectedModel =
          (typeof modelOption?.currentValue === 'string'
            ? modelOption.currentValue
            : modelOption?.options?.[0]?.value) ?? 'default';
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.logout(providerId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.activate(providerId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return providerService.sync();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.refresh(providerId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.install(providerId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (providerId: string) => {
      return providerService.remove(providerId);
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
      return providerService.updateConfig(providerId, customEnv, nativelyLoadsSkills);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
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
  const updateProviderConfig = useMemo(
    () =>
      wrapMutate('config', updateProviderConfigMutation, {
        successMessage: 'Configuration updated',
      }),
    [wrapMutate, updateProviderConfigMutation],
  );
  const installProvider = useMemo(
    () => wrapMutate('install', installMutation, { successMessage: 'Provider installed' }),
    [wrapMutate, installMutation],
  );
  const removeProvider = useMemo(
    () => wrapMutate('remove', removeMutation, { successMessage: 'Provider removed' }),
    [wrapMutate, removeMutation],
  );

  return {
    providers,
    isLoadingProviders,
    registry,
    isLoadingRegistry,
    switchProvider,
    login,
    isLoggingIn: loginMutation.isPending,
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
    isUpdatingConfig: updateProviderConfigMutation.isPending,
    installProvider,
    isInstalling: installMutation.isPending,
    installingProviderId: installMutation.isPending ? installMutation.variables : null,
    removeProvider,
    isRemoving: removeMutation.isPending,
    removingProviderId: removeMutation.isPending ? removeMutation.variables : null,
  };
}
