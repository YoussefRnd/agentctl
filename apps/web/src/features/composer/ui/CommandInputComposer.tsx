import React from 'react';
import { Plus, FileUp, CornerDownLeft } from 'lucide-react';
import { cn } from '@agentctl/ui';
import { AttachmentStrip } from './AttachmentStrip';
import { ContextDropdown } from './ContextDropdown';
import { ContextChipStrip } from './ContextChipStrip';
import type { PendingAttachment } from '../model/useAttachments';
import type { UseContextAutocompleteReturn } from '../model/useContextAutocomplete';

interface CommandInfo {
  name: string;
  description?: string;
  input?: { hint?: string };
  category?: string;
}

interface SlashCommandsDropdownProps {
  showSlashMenu: boolean;
  filteredCommands: CommandInfo[];
  activeCommandIndex: number;
  commandRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onSelectCommand: (cmd: CommandInfo) => void;
}

function SlashCommandsDropdown({
  showSlashMenu,
  filteredCommands,
  activeCommandIndex,
  commandRefs,
  onSelectCommand,
}: SlashCommandsDropdownProps) {
  if (!showSlashMenu || filteredCommands.length === 0) return null;
  return (
    <div className="border-border/30 bg-brand-mantle/95 motion-floating animate-in fade-in-0 slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2.5 flex max-h-76 w-full flex-col overflow-hidden rounded-xl border p-1 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-150">
      {/* Header */}
      <div className="border-border/20 flex items-center justify-between border-b px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="bg-accent/15 text-accent flex h-4.5 w-4.5 items-center justify-center rounded font-mono text-[11px] font-bold">
            /
          </span>
          <span className="text-text-main text-[11px] font-semibold tracking-tight">Commands</span>
        </div>
        <span className="text-text-muted/50 font-mono text-[10px]">
          {filteredCommands.length} {filteredCommands.length === 1 ? 'command' : 'commands'}
        </span>
      </div>

      {/* Commands List */}
      <div className="custom-scrollbar flex max-h-60 flex-col gap-0.5 overflow-y-auto p-1">
        {filteredCommands.map((cmd, index) => {
          const isActive = index === activeCommandIndex;
          return (
            <button
              key={cmd.name}
              ref={(el) => {
                commandRefs.current[index] = el;
              }}
              type="button"
              onClick={() => {
                onSelectCommand(cmd);
              }}
              className={cn(
                'group/item flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150 select-none',
                isActive
                  ? 'bg-accent/15 text-text-main shadow-xs'
                  : 'text-text-muted hover:text-text-main hover:bg-white/5',
              )}
            >
              <div
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold transition-colors',
                  isActive
                    ? 'bg-accent/20 text-accent'
                    : 'bg-surface-secondary/70 text-text-muted/80 group-hover/item:text-text-main',
                )}
              >
                /
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs font-semibold',
                    isActive ? 'text-accent' : 'text-text-main',
                  )}
                >
                  {cmd.name}
                </span>
                {cmd.description && (
                  <span className="text-text-muted/70 truncate text-[11px] leading-normal">
                    {cmd.description}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {cmd.input?.hint && (
                  <span className="border-border/30 bg-surface-secondary/60 text-text-muted/70 rounded border px-1.5 py-0.5 font-mono text-[9px]">
                    {cmd.input.hint}
                  </span>
                )}
                {cmd.category && (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase',
                      cmd.category === 'Skill'
                        ? 'border-accent/30 bg-accent/15 text-accent border'
                        : 'border-border/30 bg-surface-secondary/60 text-text-muted/60 border',
                    )}
                  >
                    {cmd.category}
                  </span>
                )}
                {isActive && (
                  <CornerDownLeft className="text-accent/80 h-3 w-3 shrink-0 opacity-80" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Keyboard navigation helper footer */}
      <div className="border-border/15 bg-surface-secondary/20 text-text-muted/50 flex items-center justify-between border-t px-2.5 py-1.5 text-[10px]">
        <span className="truncate">Execute shortcut or skill</span>
        <div className="flex items-center gap-2 font-mono text-[9px]">
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              Tab
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="border-border/40 bg-surface text-text-muted rounded border px-1 py-0.5">
              Esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}

interface CommandInputHintProps {
  showSlashMenu: boolean;
  matchingCommand?: CommandInfo;
}

function CommandInputHint({ showSlashMenu, matchingCommand }: CommandInputHintProps) {
  if (showSlashMenu || !matchingCommand) return null;
  return (
    <div className="border-accent/30 bg-brand-mantle/95 animate-in fade-in-0 slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-2.5 flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl duration-150 ease-out">
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
  const getPlaceholder = () => {
    if (disabled) return disabledReason ?? 'Connecting to session...';
    if (status === 'running') return 'Type a message to queue...';
    if (placeholder) return placeholder;
    return variant === 'hero'
      ? 'Ask for changes, send follow-ups, or attach images...'
      : 'Ask a question, type @ for context, or / for commands...';
  };

  return (
    <>
      <SlashCommandsDropdown
        showSlashMenu={showSlashMenu}
        filteredCommands={filteredCommands}
        activeCommandIndex={activeCommandIndex}
        commandRefs={commandRefs}
        onSelectCommand={handleSelectCommand}
      />

      {contextAutocomplete && (
        <ContextDropdown
          isOpen={contextAutocomplete.isOpen}
          items={contextAutocomplete.items}
          isLoading={contextAutocomplete.isLoading}
          activeIndex={contextAutocomplete.activeIndex}
          onSelectItem={contextAutocomplete.selectItem}
          filterType={contextAutocomplete.filterType}
          setFilterType={contextAutocomplete.setFilterType}
        />
      )}

      <CommandInputHint showSlashMenu={showSlashMenu} matchingCommand={matchingCommand} />

      <div
        data-font-ctx="buffer"
        className={cn(
          variant === 'hero'
            ? 'border-border/40 bg-surface-secondary/50 relative flex flex-col overflow-visible rounded-2xl border shadow-2xl ring-1 ring-white/5 backdrop-blur-2xl transition-all duration-300'
            : 'bg-brand-mantle border-border/30 relative flex flex-col overflow-visible rounded-xl border transition-colors duration-200',
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
          <div className="border-accent/40 bg-accent/[0.04] ring-accent/20 pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border border-dashed ring-1 backdrop-blur-[2px] transition-all duration-150">
            <div className="text-accent flex items-center gap-2 text-xs font-medium tracking-tight">
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
            <div className="flex w-full items-start gap-3 px-5 pt-4 pb-4">
              <button
                type="button"
                disabled={disabled}
                onClick={handleAttachClick}
                className="text-text-muted hover:text-accent hover:bg-accent/10 focus-visible:ring-accent/50 mt-[3px] flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
                title={supportsImageAttachments ? 'Attach image or file' : 'Attach file as context'}
                aria-label="Attach files"
              >
                <Plus className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    handleInputChange(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (contextAutocomplete?.isOpen) {
                      const handled = contextAutocomplete.handleKeyDown(e);
                      if (handled) return;
                    }

                    if (showSlashMenu && filteredCommands.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const nextIndex = (activeCommandIndex + 1) % filteredCommands.length;
                        setActiveCommandIndex(nextIndex);
                        commandRefs.current[nextIndex]?.scrollIntoView({
                          block: 'nearest',
                          behavior: 'smooth',
                        });
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prevIndex =
                          (activeCommandIndex - 1 + filteredCommands.length) %
                          filteredCommands.length;
                        setActiveCommandIndex(prevIndex);
                        commandRefs.current[prevIndex]?.scrollIntoView({
                          block: 'nearest',
                          behavior: 'smooth',
                        });
                      } else if (e.key === 'Enter' || e.key === 'Tab') {
                        const selected = filteredCommands[activeCommandIndex];
                        const completedText = '/' + selected.name + (selected.input ? ' ' : '');

                        if (input === completedText) {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSubmit();
                          }
                        } else {
                          e.preventDefault();
                          handleInputChange(completedText);
                        }
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        handleInputChange(input.replace('/', ''));
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
                  className="placeholder:text-text-muted/40 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 pt-[3px] font-sans text-[15px] leading-relaxed outline-none focus:ring-0 focus:outline-none"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Attachment strip — only visible when there are files */}
            {attachments.length > 0 && (
              <>
                <div className="bg-border/20 mx-5 h-px" />
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
        <div className="bg-border/20 mx-5 h-px" />

        {/* Render children/toolbar here */}
        {children}
      </div>
    </>
  );
}
