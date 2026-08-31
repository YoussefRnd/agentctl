import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@agentctl/ui';
import { AttachmentStrip } from '../AttachmentStrip';
import { ContextDropdown } from './ContextDropdown';
import { ContextChipStrip } from './ContextChipStrip';
import type { PendingAttachment } from '../../../../hooks/useAttachments';
import type { UseContextAutocompleteReturn } from '../../../../hooks/useContextAutocomplete';

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
    <div className="border-border bg-brand-mantle absolute bottom-full left-0 z-50 mb-3 flex max-h-64 w-full [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto scroll-smooth rounded-md border p-1.5 shadow-2xl ring-1 ring-white/5 backdrop-blur-xl [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
              'group/item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-200',
              isActive
                ? 'bg-accent/15 text-accent border-accent/20 border'
                : 'text-text-main hover:bg-surface-secondary/80 hover:text-text-main border border-transparent',
            )}
          >
            <span
              className={cn(
                'shrink-0 font-mono text-[13px] font-bold',
                isActive ? 'text-accent' : 'text-text-main',
              )}
            >
              /{cmd.name}
            </span>
            <span className="text-text-muted flex-1 truncate font-sans text-[11px] opacity-70 group-hover/item:opacity-100">
              {cmd.description}
            </span>
            {cmd.category && (
              <span
                className={cn(
                  'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium opacity-70 group-hover/item:opacity-90',
                  cmd.category === 'Skill'
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-border bg-surface-secondary/40 text-text-muted',
                )}
              >
                {cmd.category}
              </span>
            )}
            {cmd.input?.hint && (
              <span className="text-text-muted bg-surface-secondary border-border shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium opacity-60 group-hover/item:opacity-90">
                {cmd.input.hint}
              </span>
            )}
          </button>
        );
      })}
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
    <div className="border-accent/20 bg-brand-mantle animate-in fade-in-0 slide-in-from-bottom-2 absolute bottom-full left-0 z-50 mb-3 flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 shadow-2xl ring-1 ring-white/5 backdrop-blur-xl duration-150 ease-out">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <div className="flex items-center gap-2">
          <span className="text-accent font-mono text-sm font-bold">/{matchingCommand.name}</span>
          {matchingCommand.input?.hint && (
            <span className="text-text-muted bg-accent/10 border-accent/20 rounded-md border px-1.5 py-0.5 text-[10px] font-bold">
              [{matchingCommand.input.hint}]
            </span>
          )}
        </div>
        <span className="text-text-muted truncate text-xs leading-normal opacity-80">
          {matchingCommand.description}
        </span>
      </div>
      {matchingCommand.input?.hint && (
        <span className="text-accent shrink-0 animate-pulse text-[10px] font-bold">
          Provide the {matchingCommand.input.hint}...
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
  handleAttachClick: () => void;
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
}

export function CommandInputComposer({
  flags = {},
  disabledReason,
  input,
  handleInputChange,
  setIsFocused,
  handleSubmit,
  handlePaste,
  handleDrop,
  handleAttachClick,
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
  } = flags;
  const getPlaceholder = () => {
    if (disabled) return disabledReason ?? 'Connecting to session...';
    if (status === 'running') return 'Type a message to queue...';
    return placeholder ?? 'Ask a question, type @ for context, or / for commands...';
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
          'bg-brand-mantle border-border/30 flex flex-col overflow-visible rounded-xl border transition-colors duration-300',
          hasQueuedMessages && 'rounded-t-none border-t-0',
          disabled ? 'opacity-55' : 'opacity-100',
          isFocused
            ? 'border-accent/50 ring-accent/30 shadow-[0_8px_32px_rgba(203,166,247,0.15)] ring-1'
            : 'border-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
        )}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={handleDrop}
      >
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
                className="text-text-muted hover:text-accent hover:bg-accent/10 focus-visible:ring-accent/50 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                title="Attach image"
                aria-label="Attach image"
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
