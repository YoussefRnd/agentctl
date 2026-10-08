import React, { useEffect, useId, useState } from 'react';
import { afterPaint, journeyPerformance } from '@/shared/lib/performanceRecorder';
import { Plus, FileUp } from 'lucide-react';
import { cn, IconButton, Popover, PopoverAnchor } from '@agentctl/ui';
import { AttachmentStrip } from './AttachmentStrip';
import { ContextDropdown } from './ContextDropdown';
import { ContextChipStrip } from './ContextChipStrip';
import { SlashCommandsDropdown } from './SlashCommandsDropdown';
import type { PendingAttachment } from '../model/useAttachments';
import type { UseContextAutocompleteReturn } from '../model/useContextAutocomplete';

interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

interface CommandInputHintProps {
  showSlashMenu: boolean;
  matchingCommand?: CommandInfo;
}

function CommandInputHint({ showSlashMenu, matchingCommand }: CommandInputHintProps) {
  if (showSlashMenu || !matchingCommand) return null;
  return (
    <div className="border-accent/30 bg-brand-mantle/95 absolute bottom-full left-0 z-50 mb-2.5 flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <div className="bg-accent/20 text-accent flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold">
          /
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-accent font-mono text-xs font-semibold">
              /{matchingCommand.name}
            </span>
            {matchingCommand.input?.hint && (
              <span className="border-accent/20 bg-accent/10 text-accent rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium">
                [{matchingCommand.input.hint}]
              </span>
            )}
          </div>
          {matchingCommand.description && (
            <span className="text-text-muted truncate text-[11px] leading-normal opacity-80">
              {matchingCommand.description}
            </span>
          )}
        </div>
      </div>
      {matchingCommand.input?.hint && (
        <span className="text-accent shrink-0 animate-pulse font-mono text-[10px] font-medium">
          Enter {matchingCommand.input.hint}...
        </span>
      )}
    </div>
  );
}

export interface CommandInputComposerFlags {
  hasQueuedMessages?: boolean;
  disabled?: boolean;
  isFocused?: boolean;
  showSlashMenu?: boolean;
  isUnauthenticated?: boolean;
  isDraggingOver?: boolean;
}

interface CommandInputComposerProps {
  flags?: CommandInputComposerFlags;
  disabledReason?: string;
  input: string;
  handleInputChange: (val: string) => void;
  setIsFocused: (focused: boolean) => void;
  handleSubmit: () => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragEnter?: (e: React.DragEvent<HTMLDivElement>) => void;
  handleDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  handleAttachClick: () => void;
  supportsImageAttachments?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filteredCommands: CommandInfo[];
  activeCommandIndex: number;
  setActiveCommandIndex: (index: number) => void;
  commandRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  handleSelectCommand: (cmd: CommandInfo) => void;
  matchingCommand?: CommandInfo;
  attachments: PendingAttachment[];
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
  contextAutocomplete?: UseContextAutocompleteReturn;
  handleHistoryUp?: () => boolean;
  handleHistoryDown?: () => boolean;
  placeholder?: string;
  status?: string;
  authPanelContent?: React.ReactNode;
  children?: React.ReactNode;
  variant?: 'default' | 'hero';
}

export function CommandInputComposer({
  flags = {},
  disabledReason,
  input,
  handleInputChange,
  setIsFocused,
  variant = 'default',
  handleSubmit,
  handlePaste,
  handleDrop,
  handleDragEnter,
  handleDragLeave,
  handleAttachClick,
  supportsImageAttachments = true,
  textareaRef,
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
  placeholder,
  status,
  authPanelContent,
  children,
}: CommandInputComposerProps) {
  const {
    hasQueuedMessages = false,
    disabled = false,
    isFocused = false,
    showSlashMenu = false,
    isUnauthenticated = false,
    isDraggingOver = false,
  } = flags;
  useEffect(() => {
    if (!journeyPerformance.enabled || disabled || isUnauthenticated || !textareaRef.current)
      return;
    return afterPaint(() => journeyPerformance.finish('launch-to-typeable'));
  }, [disabled, isUnauthenticated, textareaRef]);
  const slashListboxId = useId();
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | null>(null);
  const slashMenuOpen = showSlashMenu && dismissedSlashInput !== input;
  const dismissSlashMenu = () => setDismissedSlashInput(input);
  useEffect(() => {
    if (!showSlashMenu) setDismissedSlashInput(null);
  }, [showSlashMenu]);

  const getPlaceholder = () => {
    if (disabled) return disabledReason ?? 'Connecting to session...';
    if (status === 'running') return 'Type a message to queue...';
    if (placeholder) return placeholder;
    return variant === 'hero'
      ? 'Ask for changes, send follow-ups, or attach images...'
      : 'Ask a question, type @ for context, or / for commands...';
  };

  return (
    <Popover open={slashMenuOpen || (contextAutocomplete?.isOpen ?? false)}>
      <SlashCommandsDropdown
        isOpen={slashMenuOpen}
        commands={filteredCommands}
        query={input.slice(1)}
        listboxId={slashListboxId}
        activeIndex={activeCommandIndex}
        commandRefs={commandRefs}
        onActiveIndexChange={setActiveCommandIndex}
        onSelectCommand={handleSelectCommand}
        onDismiss={dismissSlashMenu}
      />

      {contextAutocomplete && (
        <ContextDropdown
          isOpen={contextAutocomplete.isOpen}
          items={contextAutocomplete.items}
          isLoading={contextAutocomplete.isLoading}
          searchError={contextAutocomplete.searchError}
          query={contextAutocomplete.query}
          listboxId={contextAutocomplete.listboxId}
          attachedContexts={contextAutocomplete.attachedContexts}
          onActiveIndexChange={contextAutocomplete.setActiveIndex}
          onDismiss={() => contextAutocomplete.setIsOpen(false)}
          activeIndex={contextAutocomplete.activeIndex}
          onSelectItem={contextAutocomplete.selectItem}
          filterType={contextAutocomplete.filterType}
          setFilterType={contextAutocomplete.setFilterType}
        />
      )}

      <CommandInputHint showSlashMenu={showSlashMenu} matchingCommand={matchingCommand} />

      <PopoverAnchor asChild>
        <div
          data-font-ctx="buffer"
          className={cn(
            variant === 'hero'
              ? 'border-border/40 bg-surface-secondary/50 relative flex min-w-0 flex-col overflow-visible rounded-xl border shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl transition-[border-color,background-color,box-shadow,opacity] duration-200 ease-out'
              : 'bg-brand-mantle border-border/30 relative flex min-w-0 flex-col overflow-visible rounded-xl border transition-colors duration-200',
            hasQueuedMessages && 'rounded-t-none border-t-0',
            disabled ? 'opacity-55' : 'opacity-100',
            isDraggingOver
              ? 'border-accent/60 ring-accent/30 bg-accent/[0.02] ring-1'
              : isFocused
                ? variant === 'hero'
                  ? 'border-accent/60 ring-accent/30 shadow-[0_12px_40px_rgba(203,166,247,0.18)] ring-2'
                  : 'border-accent/50 ring-accent/30 shadow-[0_8px_32px_rgba(203,166,247,0.15)] ring-1'
                : variant === 'hero'
                  ? 'hover:border-border/70'
                  : 'border-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer) {
              e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Visual drop overlay when dragging files or folders over the composer */}
          {isDraggingOver && (
            <div className="border-accent/40 bg-accent/[0.04] ring-accent/20 pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border border-dashed ring-1 backdrop-blur-[2px] transition-[border-color,background-color,opacity] duration-150 ease-out">
              <div className="text-accent flex min-w-0 items-center gap-2 px-3 text-center text-xs font-medium tracking-tight">
                <FileUp className="h-4 w-4" />
                <span>Drop files or folders to attach</span>
              </div>
            </div>
          )}

          {isUnauthenticated ? (
            authPanelContent
          ) : (
            <>
              {/* Context chips for @ file/git attachments */}
              {contextAutocomplete && contextAutocomplete.attachedContexts.length > 0 && (
                <ContextChipStrip
                  contexts={contextAutocomplete.attachedContexts}
                  onRemove={contextAutocomplete.removeAttachedContext}
                />
              )}

              {/* Input row */}
              <div className="flex w-full items-start gap-2 px-3 pt-3 pb-3 sm:gap-3 sm:px-5 sm:pt-4 sm:pb-4">
                <IconButton
                  disabled={disabled}
                  onClick={handleAttachClick}
                  size="compact"
                  className="hover:text-accent hover:bg-accent/10 mt-[3px] shrink-0 rounded-full"
                  title={
                    supportsImageAttachments ? 'Attach image or file' : 'Attach file as context'
                  }
                  aria-label="Attach files"
                >
                  <Plus className="h-4 w-4" />
                </IconButton>
                <div className="min-w-0 flex-1">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => {
                      handleInputChange(e.target.value);
                      contextAutocomplete?.syncSelection();
                    }}
                    onSelect={contextAutocomplete?.syncSelection}
                    aria-autocomplete={contextAutocomplete || showSlashMenu ? 'list' : undefined}
                    aria-expanded={
                      contextAutocomplete || showSlashMenu
                        ? Boolean(contextAutocomplete?.isOpen || slashMenuOpen)
                        : undefined
                    }
                    aria-controls={
                      contextAutocomplete?.isOpen
                        ? contextAutocomplete.listboxId
                        : slashMenuOpen
                          ? slashListboxId
                          : undefined
                    }
                    aria-activedescendant={
                      contextAutocomplete?.isOpen &&
                      contextAutocomplete.items[contextAutocomplete.activeIndex]
                        ? `${contextAutocomplete.listboxId}-option-${contextAutocomplete.activeIndex}`
                        : slashMenuOpen && filteredCommands[activeCommandIndex]
                          ? `${slashListboxId}-option-${activeCommandIndex}`
                          : undefined
                    }
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (contextAutocomplete?.isOpen) {
                        const handled = contextAutocomplete.handleKeyDown(e);
                        if (handled) return;
                      }

                      if (slashMenuOpen) {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          dismissSlashMenu();
                          return;
                        }
                        if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                          e.preventDefault();
                          const selected = filteredCommands[activeCommandIndex];
                          if (!selected) return;
                          const completedText = '/' + selected.name + (selected.input ? ' ' : '');
                          if (input === completedText) {
                            if (e.key === 'Enter') handleSubmit();
                          } else {
                            handleInputChange(completedText);
                          }
                        } else if (
                          filteredCommands.length > 0 &&
                          (e.key === 'ArrowDown' || e.key === 'ArrowUp')
                        ) {
                          e.preventDefault();
                          const step = e.key === 'ArrowDown' ? 1 : -1;
                          setActiveCommandIndex(
                            (activeCommandIndex + step + filteredCommands.length) %
                              filteredCommands.length,
                          );
                        }
                      } else {
                        if (e.key === 'ArrowUp') {
                          if (handleHistoryUp?.()) {
                            e.preventDefault();
                            return;
                          }
                        } else if (e.key === 'ArrowDown') {
                          if (handleHistoryDown?.()) {
                            e.preventDefault();
                            return;
                          }
                        }

                        if (e.key === 'Backspace' && input === '') {
                          if (
                            contextAutocomplete &&
                            contextAutocomplete.attachedContexts.length > 0
                          ) {
                            e.preventDefault();
                            const last =
                              contextAutocomplete.attachedContexts[
                                contextAutocomplete.attachedContexts.length - 1
                              ];
                            if (last) {
                              contextAutocomplete.removeAttachedContext(last.id);
                            }
                            return;
                          }
                        }

                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }
                    }}
                    onFocus={() => {
                      setIsFocused(true);
                    }}
                    onBlur={() => {
                      setIsFocused(false);
                    }}
                    onPaste={handlePaste}
                    placeholder={getPlaceholder()}
                    aria-label="Command input"
                    className="placeholder:text-text-muted/40 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full min-w-0 resize-none border-none bg-transparent p-0 pt-[3px] font-sans text-[15px] leading-relaxed [overflow-wrap:anywhere] outline-none focus:ring-0 focus:outline-none"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    disabled={disabled}
                  />
                </div>
              </div>

              {/* Attachment strip — only visible when there are files */}
              {attachments.length > 0 && (
                <>
                  <div className="bg-border/20 mx-3 h-px sm:mx-5" />
                  <AttachmentStrip
                    attachments={attachments}
                    onRemove={removeAttachment}
                    onRetry={retryAttachment}
                  />
                </>
              )}
            </>
          )}

          {/* Hairline separator anchors toolbar below input */}
          <div className="bg-border/20 mx-3 h-px sm:mx-5" />

          {/* Render children/toolbar here */}
          {children}
        </div>
      </PopoverAnchor>
    </Popover>
  );
}
