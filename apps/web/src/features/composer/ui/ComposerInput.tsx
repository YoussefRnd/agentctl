import type { ReactNode } from 'react';
import type { useComposerState } from '../model/useComposerState';
import { CommandInputComposer } from './CommandInputComposer';

export function ComposerInput({
  state,
  children,
  disabled,
  disabledReason,
  placeholder,
  variant = 'default',
  hasQueuedMessages = false,
}: {
  state: ReturnType<typeof useComposerState>;
  children: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
  variant?: 'default' | 'hero';
  hasQueuedMessages?: boolean;
}) {
  const {
    input,
    handleInputChange,
    isFocused,
    showSlashMenu,
    isDraggingOver,
    handleSubmit,
    handlePaste,
    handleDrop,
    handleDragEnter,
    handleDragLeave,
    handleAttachClick,
    supportsImageAttachments,
    textareaRef,
    fileInputRef,
    handleFileInputChange,
    filteredCommands,
    activeCommandIndex,
    setActiveCommandIndex,
    commandRefs,
    handleSelectCommand,
    matchingCommand,
    attachments,
    removeAttachment,
    retryAttachment,
    contextAutocomplete,
    handleHistoryUp,
    handleHistoryDown,
    sessionData,
    setIsFocused,
  } = state;
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
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
          void handleSubmit();
        }}
      >
        <CommandInputComposer
          flags={{
            hasQueuedMessages,
            disabled,
            isFocused,
            showSlashMenu,
            isDraggingOver,
          }}
          disabledReason={disabledReason}
          input={input}
          handleInputChange={handleInputChange}
          setIsFocused={setIsFocused}
          handleSubmit={handleSubmit}
          handlePaste={handlePaste}
          handleDrop={handleDrop}
          handleDragEnter={handleDragEnter}
          handleDragLeave={handleDragLeave}
          handleAttachClick={handleAttachClick}
          supportsImageAttachments={supportsImageAttachments}
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
          handleHistoryUp={handleHistoryUp}
          handleHistoryDown={handleHistoryDown}
          placeholder={placeholder}
          status={sessionData?.session.status}
          variant={variant}
        >
          {children}
        </CommandInputComposer>
      </form>
    </>
  );
}
