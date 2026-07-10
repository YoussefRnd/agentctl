import { CommandBarToolbar } from './CommandBarToolbar';
import { CommandBarFooter } from './command-bar/WorkspaceStateReviewer';
import { useCommandBarState } from './useCommandBarState';
import { CommandInputComposer } from './command-bar/CommandInputComposer';

interface ControlBarProps {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
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
  } = useCommandBarState({
    onSend,
    disabled,
    propSelectedProviderId,
    onProviderSelect,
    initialInput,
  });

  return (
    <div className="w-full">
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
          disabled={disabled}
          input={input}
          handleInputChange={handleInputChange}
          isFocused={isFocused}
          setIsFocused={setIsFocused}
          handleSubmit={handleSubmit}
          handlePaste={handlePaste}
          handleDrop={handleDrop}
          handleAttachClick={handleAttachClick}
          textareaRef={textareaRef}
          showSlashMenu={showSlashMenu}
          filteredCommands={filteredCommands}
          activeCommandIndex={activeCommandIndex}
          setActiveCommandIndex={setActiveCommandIndex}
          commandRefs={commandRefs}
          handleSelectCommand={handleSelectCommand}
          matchingCommand={matchingCommand}
          attachments={attachments}
          removeAttachment={removeAttachment}
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
            isUpdatingAgentPersona={isUpdatingAgentPersona}
            handleSetConfigOption={setSessionConfigOption}
            isUpdatingConfigOption={isUpdatingConfigOption}
            canSend={canSend}
            handleSubmit={handleSubmit}
            isRunning={isRunning}
            onCancel={handleCancel}
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
    </div>
  );
}
