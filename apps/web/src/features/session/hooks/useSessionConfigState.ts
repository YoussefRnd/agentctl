import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@agentctl/api-client';
import { sessionKeys } from '../../../shared/lib/queryKeys';

export function useSessionConfigState(sessionId: string) {
  const queryClient = useQueryClient();

  const updateProviderMutation = useMutation({
    mutationFn: async ({ providerId, modelId }: { providerId: string; modelId?: string }) => {
      const res = await api.updateSessionProvider({
        params: { id: sessionId },
        body: { providerId, modelId },
      });
      if (res.status !== 200) {
        throw new Error(`Failed to update provider: ${String(res.status)}`);
      }
      return res.body;
    },
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
    mutationFn: async (approvalMode: 'review' | 'auto_approve' | 'yolo') => {
      const res = await api.setApprovalMode({
        params: { id: sessionId },
        body: { approvalMode },
      });
      if (res.status !== 200) {
        throw new Error(`Failed to set approval mode: ${String(res.status)}`);
      }
      return res.body;
    },
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
    mutationFn: async (persona: string) => {
      const res = await api.setAgentPersona({
        params: { id: sessionId },
        body: { persona },
      });
      if (res.status !== 200) {
        throw new Error(`Failed to set agent persona: ${String(res.status)}`);
      }
      return res.body;
    },
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
    mutationFn: async ({ configId, value }: { configId: string; value: string }) => {
      const res = await api.setSessionConfigOption({
        params: { id: sessionId },
        body: { configId, value },
      });
      if (res.status !== 200) {
        throw new Error(`Failed to set config option: ${String(res.status)}`);
      }
      return res.body;
    },
    onSuccess: () => {
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
