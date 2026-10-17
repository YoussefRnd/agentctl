import { sessionKeys, projectKeys } from '@/shared/lib/queryKeys';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { handoffSession } from '@agentctl/api-client';
import type { SessionEventRow, SessionWithCapabilities } from '@agentctl/shared';
import { useDraftStore } from '@/features/composer';
import type { useProviders } from '@/features/providers';

/** Coordinates provider changes and handoff; conversation rendering owns no handoff I/O. */
export function useConversationHandoff({
  sessionId,
  sessionData,
  events,
  switchProvider,
}: {
  sessionId: string;
  sessionData: SessionWithCapabilities | null;
  events: SessionEventRow[];
  switchProvider: ReturnType<typeof useProviders>['switchProvider'];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [switchAgentTarget, setSwitchAgentTarget] = useState<{
    targetProvider: string;
    targetModel?: string;
  } | null>(null);
  const [isHandoffLoading, setIsHandoffLoading] = useState(false);

  const hasUserMessages = useMemo(() => {
    return events.some((e) => {
      if (e.type !== 'text' || !e.data) return false;
      try {
        const data = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as {
          role?: string;
          text?: string;
          content?: string;
        };
        return data.role === 'user' && Boolean(data.text || data.content);
      } catch {
        return false;
      }
    });
  }, [events]);

  const handleProviderSelect = (providerId: string, modelId?: string) => {
    if (isHandoffLoading) {
      toast.info('An agent handoff is already in progress');
      return;
    }
    const currentProvider = sessionData?.session.selectedProvider;
    // If selecting the current provider or the session is empty: do in-place switch directly
    if (providerId === currentProvider || !hasUserMessages) {
      switchProvider(providerId, modelId, sessionData);
      return;
    }

    // Active session switching to a different provider: trigger handoff modal
    setSwitchAgentTarget({
      targetProvider: providerId,
      targetModel: modelId,
    });
  };

  const handleConfirmHandoff = async (nextSessionFocus?: string) => {
    if (!sessionId || !switchAgentTarget) return;
    const target = switchAgentTarget;
    setIsHandoffLoading(true);
    // The source agent may request permission while preparing the handoff. Close
    // the modal so those approval controls remain reachable in the main feed.
    setSwitchAgentTarget(null);
    try {
      const result = await handoffSession(
        sessionId,
        target.targetProvider,
        target.targetModel,
        nextSessionFocus,
      );
      toast.success(
        result.handoffSource === 'skill'
          ? `Handoff completed with ${target.targetProvider}`
          : `Handoff completed with generated context for ${target.targetProvider}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionKeys.detail(result.sessionId) }),
        queryClient.invalidateQueries({ queryKey: sessionKeys.events(result.sessionId) }),
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      ]);
      if (result.sessionId !== sessionId) {
        void navigate(`/sessions/${result.sessionId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to switch agent');
    } finally {
      setIsHandoffLoading(false);
    }
  };

  const handleConfirmNewSession = () => {
    const projectId = sessionData?.session.projectId;
    if (!projectId || !switchAgentTarget) return;
    const target = switchAgentTarget;
    setSwitchAgentTarget(null);
    useDraftStore.getState().updateHomeDraft(projectId, {
      mode: sessionData.session.mode,
      providerId: target.targetProvider,
      selectedModel: target.targetModel,
      selectedThinkingEffort: undefined,
      thinkingConfig: undefined,
      agentPersona: undefined,
    });
    void navigate(`/?project=${encodeURIComponent(projectId)}`);
  };

  return {
    switchAgentTarget,
    setSwitchAgentTarget,
    isHandoffLoading,
    hasUserMessages,
    handleProviderSelect,
    handleConfirmHandoff,
    handleConfirmNewSession,
  };
}
