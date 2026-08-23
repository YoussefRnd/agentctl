import { useState } from 'react';
import { useSessionStream } from '../../../contexts/SessionContext';
import { CommandBarToolbar } from './CommandBarToolbar';
import { CommandBarFooter } from './command-bar/WorkspaceStateReviewer';
import { useCommandBarState } from './useCommandBarState';
import { CommandInputComposer } from './command-bar/CommandInputComposer';
import { QueuedMessagesPillStack } from './command-bar/QueuedMessagesPillStack';
import { ProviderAuthModal } from './ProviderAuthModal';

interface ControlBarProps {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  onProviderSelect?: (id: string, modelId?: string) => void;
  placeholder?: string;
  initialInput?: string;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export function CommandBar({
  onSend,
  disabled,
  disabledReason,
  selectedProviderId: propSelectedProviderId,
  selectedModelId: propSelectedModelId,
  onProviderSelect,
  placeholder = 'Ask for follow-up changes or attach images',
  initialInput,
}: ControlBarProps) {
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
    input,
    handleInputChange,
    activeCommandIndex,
    setActiveCommandIndex,
    isRunning,
    handleCancel,
    commandRefs,
    showSlashMenu,
    filteredCommands,
    matchingCommand,
    isPickerOpen,
    setIsPickerOpen,
    isFocused,
    setIsFocused,
    textareaRef,
    fileInputRef,
    attachments,
    removeAttachment,
    retryAttachment,
    resolvedId,
    activeProvider,
    selectedProviderLabel,
    handleSubmit,
    handleProviderSelect,
    handleAttachClick,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    canSend,
    handleSelectCommand,
    contextAutocomplete,
  } = useCommandBarState(
    onSend,
    disabled,
    propSelectedProviderId ?? undefined,
    propSelectedModelId ?? undefined,
    onProviderSelect,
    initialInput,
  );

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const { queuedMessages } = useSessionStream();
  const hasQueuedMessages = queuedMessages.length > 0;

  return (
    <div className="flex w-full flex-col">
      <QueuedMessagesPillStack />

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileInputChange}
      />

      <form
        className="relative w-full"
        aria-label="Command interface"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <CommandInputComposer
          flags={{
            hasQueuedMessages,
            disabled,
            isFocused,
            showSlashMenu,
          }}
          disabledReason={disabledReason}
          input={input}
          handleInputChange={handleInputChange}
          setIsFocused={setIsFocused}
          handleSubmit={handleSubmit}
          handlePaste={handlePaste}
          handleDrop={handleDrop}
          handleAttachClick={handleAttachClick}
          textareaRef={textareaRef}
          filteredCommands={filteredCommands}
          activeCommandIndex={activeCommandIndex}
          setActiveCommandIndex={setActiveCommandIndex}
          commandRefs={commandRefs}
          handleSelectCommand={handleSelectCommand}
          matchingCommand={matchingCommand}
          attachments={attachments}
          removeAttachment={removeAttachment}
          retryAttachment={retryAttachment}
          contextAutocomplete={contextAutocomplete}
          placeholder={placeholder}
          status={sessionData?.session.status}
        >
          <CommandBarToolbar
            status={{
              isLoadingSession,
              isLoadingProviders,
              isUpdatingApprovalMode,
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
            setApprovalMode={setApprovalMode}
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
            }}
          />
        </CommandInputComposer>
      </form>
      <CommandBarFooter
        isLoadingSession={isLoadingSession}
        sessionData={sessionData}
        isSwitchingMode={isSwitchingMode}
        switchMode={switchMode}
        isSwitchingBranch={isSwitchingBranch}
        switchBranch={switchBranch}
        branches={branches}
      />

      <ProviderAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
        }}
        activeProvider={activeProvider}
        sessionId={sessionId}
      />
    </div>
  );
}
