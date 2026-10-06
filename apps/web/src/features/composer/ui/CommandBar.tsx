import { useState } from 'react';
import { useSessionStream } from '@/features/sessions';
import { CommandBarToolbar } from './CommandBarToolbar';
import { CommandBarFooter } from './WorkspaceStateReviewer';
import { ApprovalModeSelector } from './SessionController';
import { useCommandBarState } from '../model/useCommandBarState';
import { ComposerInput } from './ComposerInput';
import { QueuedMessagesPillStack } from './QueuedMessagesPillStack';
import { ProviderAuthDialog } from '@/features/providers';

interface ControlBarProps {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  onProviderSelect?: (id: string, modelId?: string) => void;
  placeholder?: string;
  initialInput?: string;
  variant?: 'default' | 'hero';
}

export function CommandBar({
  onSend,
  disabled,
  disabledReason,
  selectedProviderId: propSelectedProviderId,
  selectedModelId: propSelectedModelId,
  onProviderSelect,
  placeholder,
  initialInput,
  variant = 'default',
}: ControlBarProps) {
  const state = useCommandBarState(
    onSend,
    disabled,
    propSelectedProviderId ?? undefined,
    propSelectedModelId ?? undefined,
    onProviderSelect,
    initialInput,
  );
  const {
    sessionId,
    sessionData,
    branches,
    switchBranch,
    isSwitchingBranch,
    switchMode,
    isSwitchingMode,
    setApprovalMode,
    isUpdatingApprovalMode,
    setAgentPersona,
    isUpdatingAgentPersona,
    setSessionConfigOption,
    isUpdatingConfigOption,
    isLoadingSession,
    providers,
    isLoadingProviders,
    isRunning,
    handleCancel,
    isPickerOpen,
    setIsPickerOpen,
    resolvedId,
    activeProvider,
    selectedProviderLabel,
    handleSubmit,
    handleProviderSelect,
    canSend,
  } = state;

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { queuedMessages } = useSessionStream();
  const hasQueuedMessages = queuedMessages.some((message) => message.status !== 'sending');

  return (
    <div className="flex w-full flex-col">
      <QueuedMessagesPillStack />

      <ComposerInput
        state={state}
        variant={variant}
        disabled={disabled}
        disabledReason={disabledReason}
        placeholder={placeholder}
        hasQueuedMessages={hasQueuedMessages}
      >
        <CommandBarToolbar
          status={{
            isLoadingSession,
            isLoadingProviders,
          }}
          picker={{
            isOpen: isPickerOpen,
            setIsOpen: setIsPickerOpen,
          }}
          activeProvider={activeProvider}
          providers={providers}
          propSelectedModelId={propSelectedModelId}
          selectedProviderLabel={selectedProviderLabel}
          resolvedId={resolvedId}
          handleProviderSelect={handleProviderSelect}
          sessionId={sessionId}
          sessionData={sessionData}
          setAgentPersona={setAgentPersona}
          handleSetConfigOption={setSessionConfigOption}
          handleSubmit={handleSubmit}
          onCancel={handleCancel}
          onOpenAuthModal={() => {
            setIsAuthModalOpen(true);
          }}
          flags={{
            isUpdatingAgentPersona,
            isUpdatingConfigOption,
            canSend,
            isRunning,
            isSubmitting: state.isSubmitting,
          }}
        />
      </ComposerInput>
      <CommandBarFooter
        isLoadingSession={isLoadingSession}
        sessionData={sessionData}
        isSwitchingMode={isSwitchingMode}
        switchMode={switchMode}
        isSwitchingBranch={isSwitchingBranch}
        switchBranch={switchBranch}
        branches={branches}
        approvalControl={
          <ApprovalModeSelector
            isLoading={isLoadingSession}
            sessionData={sessionData}
            isUpdating={isUpdatingApprovalMode}
            setApprovalMode={setApprovalMode}
          />
        }
      />

      <ProviderAuthDialog
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
        }}
        provider={activeProvider ?? null}
        sessionId={sessionId}
        onSuccess={(providerId) => {
          handleProviderSelect(providerId);
        }}
      />
    </div>
  );
}
