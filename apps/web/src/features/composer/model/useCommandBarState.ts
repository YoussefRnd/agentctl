import {
  useSession,
  useSessionActions,
  useSessionStream,
  useSessionTurnState,
} from '@/features/sessions';
import { useProviders } from '@/features/providers';
import { useComposerState } from './useComposerState';
export type { CommandInfo } from './useComposerState';

export function useCommandBarState(
  onSend: (value: string, attachmentIds?: string[]) => void,
  disabled?: boolean,
  selectedProviderId?: string,
  selectedModelId?: string,
  onProviderSelect?: (providerId: string, modelId?: string) => void,
  initialInput?: string,
) {
  const session = useSession();
  const turn = useSessionTurnState();
  const { handleCancel } = useSessionActions();
  const { events } = useSessionStream();
  const { providers, isLoadingProviders, switchProvider } = useProviders(session.sessionId);
  const state = useComposerState({
    onSend,
    disabled,
    sessionId: session.sessionId,
    draftKey: session.sessionId,
    sessionData: session.sessionData,
    events,
    providers,
    selectedProviderId,
    selectedModelId,
    onProviderSelect:
      onProviderSelect ??
      ((providerId, modelId) => {
        void switchProvider(providerId, modelId, session.sessionData);
      }),
    initialInput,
  });
  return {
    ...state,
    isRunning: state.isRunning || !!turn?.canCancel,
    isSubmitting: state.isSubmitting || (turn !== null && !turn.canCancel && !state.canSend),
    isLoadingProviders,
    handleCancel,
    branches: session.branches,
    switchBranch: session.switchBranch,
    isSwitchingBranch: session.isSwitchingBranch,
    switchMode: session.switchMode,
    isSwitchingMode: session.isSwitchingMode,
    setApprovalMode: session.setApprovalMode,
    isUpdatingApprovalMode: session.isUpdatingApprovalMode,
    setAgentPersona: session.setAgentPersona,
    isUpdatingAgentPersona: session.isUpdatingAgentPersona,
    setSessionConfigOption: session.setSessionConfigOption,
    isUpdatingConfigOption: session.isUpdatingConfigOption,
    isLoadingSession: session.isLoadingSession,
  };
}
