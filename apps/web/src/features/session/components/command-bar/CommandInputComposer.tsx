import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@agentctl/ui';
import { AttachmentStrip } from '../AttachmentStrip';
import type { PendingAttachment } from '../../../../hooks/useAttachments';

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
              'group/item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-all duration-200',
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
              <span className="text-text-muted bg-surface-secondary/40 border-border shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase opacity-50 group-hover/item:opacity-85">
                {cmd.category}
              </span>
            )}
            {cmd.input?.hint && (
              <span className="text-text-muted bg-surface-secondary border-border shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-tighter uppercase opacity-40 group-hover/item:opacity-80">
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
    <div className="border-accent/20 bg-brand-mantle animate-fade-in absolute bottom-full left-0 z-50 mb-3 flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 shadow-2xl ring-1 ring-white/5 backdrop-blur-xl">
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

interface CommandInputComposerProps {
  disabled?: boolean;
  input: string;
  handleInputChange: (val: string) => void;
  isFocused: boolean;
  setIsFocused: (focused: boolean) => void;
  handleSubmit: () => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  handleAttachClick: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  showSlashMenu: boolean;
  filteredCommands: CommandInfo[];
  activeCommandIndex: number;
  setActiveCommandIndex: (index: number) => void;
  commandRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  handleSelectCommand: (cmd: CommandInfo) => void;
  matchingCommand?: CommandInfo;
  attachments: PendingAttachment[];
  removeAttachment: (id: string) => void;
  placeholder?: string;
  status?: string;
  isUnauthenticated?: boolean;
  authPanelContent?: React.ReactNode;
  children?: React.ReactNode;
}

export function CommandInputComposer({
  disabled,
  input,
  handleInputChange,
  isFocused,
  setIsFocused,
  handleSubmit,
  handlePaste,
  handleDrop,
  handleAttachClick,
  textareaRef,
  showSlashMenu,
  filteredCommands,
  activeCommandIndex,
  setActiveCommandIndex,
  commandRefs,
  handleSelectCommand,
  matchingCommand,
  attachments,
  removeAttachment,
  placeholder,
  status,
  isUnauthenticated,
  authPanelContent,
  children,
}: CommandInputComposerProps) {
  return (
    <>
      <SlashCommandsDropdown
        showSlashMenu={showSlashMenu}
        filteredCommands={filteredCommands}
        activeCommandIndex={activeCommandIndex}
        commandRefs={commandRefs}
        onSelectCommand={handleSelectCommand}
      />

      <CommandInputHint showSlashMenu={showSlashMenu} matchingCommand={matchingCommand} />

      <div
        data-font-ctx="buffer"
        className={cn(
          'bg-brand-mantle border-border/30 flex flex-col overflow-visible rounded-xl border transition-all duration-300',
          disabled ? 'opacity-30' : 'opacity-100',
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
            {/* Input row */}
            <div className="flex w-full items-start gap-3 px-5 pt-5 pb-4">
              <button
                type="button"
                disabled={disabled}
                onClick={handleAttachClick}
                className="text-text-muted hover:text-accent hover:bg-accent/10 focus-visible:ring-accent/50 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                title="Attach image"
                aria-label="Attach image"
              >
                <Plus className="h-4 w-4" />
              </button>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  handleInputChange(e.target.value);
                }}
                onKeyDown={(e) => {
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
                placeholder={
                  status === 'running'
                    ? 'Type a message to queue...'
                    : disabled
                      ? 'Processing...'
                      : placeholder
                }
                aria-label="Command input"
                className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 pt-[3px] font-sans text-[15px] leading-relaxed outline-none focus:ring-0 focus:outline-none"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            {/* Attachment strip — only visible when there are files */}
            {attachments.length > 0 && (
              <>
                <div className="bg-border/20 mx-5 h-px" />
                <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
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
