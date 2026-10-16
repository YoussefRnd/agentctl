import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { patchSession } from '@agentctl/api-client';
import { toast } from 'sonner';
import { sessionKeys } from '@/shared/lib/queryKeys';

export function useSessionConfigState(sessionId: string) {
  const queryClient = useQueryClient();

  const updateProviderMutation = useMutation({
    mutationFn: ({ providerId, modelId }: { providerId: string; modelId?: string }) =>
      patchSession(sessionId, { providerId, modelId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const updateProvider = useCallback(
    async (providerId: string, modelId?: string) => {
      await updateProviderMutation.mutateAsync({ providerId, modelId });
    },
    [updateProviderMutation],
  );

  const setApprovalModeMutation = useMutation({
    mutationFn: (approvalMode: 'review' | 'auto_approve' | 'yolo') =>
      patchSession(sessionId, { approvalMode }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const handleSetApprovalMode = useCallback(
    async (approvalMode: 'review' | 'auto_approve' | 'yolo') => {
      await setApprovalModeMutation.mutateAsync(approvalMode);
    },
    [setApprovalModeMutation],
  );

  const setAgentPersonaMutation = useMutation({
    mutationFn: (persona: string) => patchSession(sessionId, { persona }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const handleSetAgentPersona = useCallback(
    async (persona: string) => {
      await setAgentPersonaMutation.mutateAsync(persona);
    },
    [setAgentPersonaMutation],
  );

  const setSessionConfigOptionMutation = useMutation({
    mutationFn: ({ configId, value }: { configId: string; value: string }) =>
      patchSession(sessionId, { configId, configValue: value }),
    // The slider reconciles with canonical props when this promise resolves.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) }),
    onError: (error: Error) => {
      toast.error('Could not change setting', { description: error.message });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.detail(sessionId) });
    },
  });

  const handleSetConfigOption = useCallback(
    async (configId: string, value: string) => {
      await setSessionConfigOptionMutation.mutateAsync({ configId, value });
    },
    [setSessionConfigOptionMutation],
  );

  return {
    updateProvider,
    isUpdatingProvider: updateProviderMutation.isPending,
    setApprovalMode: handleSetApprovalMode,
    isUpdatingApprovalMode: setApprovalModeMutation.isPending,
    setAgentPersona: handleSetAgentPersona,
    isUpdatingAgentPersona: setAgentPersonaMutation.isPending,
    setSessionConfigOption: handleSetConfigOption,
    isUpdatingConfigOption: setSessionConfigOptionMutation.isPending,
  };
}
