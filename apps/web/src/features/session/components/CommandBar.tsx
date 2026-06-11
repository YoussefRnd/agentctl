import { useState, useRef, useEffect, useCallback } from 'react';
import { Zap, Monitor, GitBranch, ChevronDown, Shield, Plus, ArrowUp } from 'lucide-react';
import {
  Dropdown,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  cn,
} from '@agentctl/ui';
import { ProviderPicker } from './ProviderPicker';
import { useProviders } from '../../../hooks/useProviders';
import { useActionDispatcher } from '../../../hooks/useActionDispatcher';
import { useSession } from '../../../contexts/SessionContext';
import { MagicBar } from './MagicBar';
import { AttachmentStrip } from './AttachmentStrip';
import { useAttachments } from '../../../hooks/useAttachments';

interface DropdownOption<T> {
  value: T;
  label: string;
}

interface CommandDropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  align?: 'start' | 'end';
  variant?: 'default' | 'toolbar';
}

function CommandDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  icon,
  align = 'start',
  variant = 'default',
}: CommandDropdownProps<T>) {
  const activeOption = options.find((opt) => opt.value === value);

  const triggerClass = variant === 'toolbar'
    ? cn(
        "flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200",
        "text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
        "disabled:pointer-events-none disabled:opacity-40",
        "data-[state=open]:bg-accent/20 data-[state=open]:text-accent data-[state=open]:border-accent/30"
      )
    : cn(
        "text-text-muted/60 hover:text-text-main flex cursor-pointer items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
        "disabled:pointer-events-none disabled:opacity-40"
      );

  const textClass = variant === 'toolbar'
    ? "max-w-[150px] truncate text-[10px] font-bold tracking-widest uppercase"
    : "max-w-[150px] truncate";

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button type="button" disabled={disabled} className={triggerClass}>
          {icon}
          <span className={textClass}>{activeOption?.label ?? value}</span>
          <ChevronDown className="text-text-muted/50 h-3 w-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} className="min-w-[140px]">
          {options.map((opt) => (
            <Dropdown.Item
              key={opt.value}
              className={cn(opt.value === value && "bg-white/5 text-accent")}
              onClick={() => {
                onChange(opt.value);
              }}
            >
              {opt.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

interface ControlBarProps {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  onProviderSelect?: (id: string, modelId?: string) => void;
  placeholder?: string;
}

function formatBranchName(branch: string) {
  if (branch.startsWith('agentctl/')) {
    const parts = branch.split('/');
    if (parts.length >= 3) {
      // Return just the task slug (e.g. "fix-dropdowns") to keep it short
      return parts.slice(2).join('/');
    }
    if (parts.length === 2) {
      return parts[1].slice(0, 8);
    }
  }
  return branch;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export function CommandBar({
  onSend,
  disabled,
  selectedProviderId: propSelectedProviderId,
  selectedModelId: propSelectedModelId,
  onProviderSelect,
  placeholder = 'Ask for follow-up changes or attach images',
}: ControlBarProps) {
  const {
    sessionId,
    reviewData,
    sessionData,
    branches,
    switchBranch,
    isSwitchingBranch,
    switchMode,
    isSwitchingMode,
    setApprovalMode,
    isUpdatingApprovalMode,
    updateProvider,
    isLoadingSession,
  } = useSession();
  const { providers, isLoadingProviders } = useProviders(sessionId);
  const { execute } = useActionDispatcher();
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { attachments, addFiles, removeAttachment, clearAll, readyAttachmentIds, isAnyUploading } =
    useAttachments(sessionId);

  const selectedId = propSelectedProviderId ?? null;

  const firstId = providers[0]?.id ?? null;
  const resolvedId = selectedId ?? firstId;
  const activeProvider = providers.find((p) => p.id === resolvedId);
  const selectedProviderLabel =
    activeProvider !== undefined ? activeProvider.label : 'Select provider';

  const handleSubmit = useCallback(() => {
    const hasText = input.trim().length > 0;
    const hasAttachments = readyAttachmentIds.length > 0;
    if ((!hasText && !hasAttachments) || disabled || isAnyUploading) return;

    onSend(input, readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined);
    setInput('');
    clearAll();
  }, [input, readyAttachmentIds, disabled, isAnyUploading, onSend, clearAll]);

  const handleProviderSelect = (id: string, modelId?: string) => {
    if (onProviderSelect) {
      onProviderSelect(id, modelId);
    } else {
      void execute('switch-provider', async () => {
        await updateProvider(id, modelId);
      }, { successMessage: `Switched to ${id}` });
    }
    setIsPickerOpen(false);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
    }
  }, [input]);

  // Close picker on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPickerOpen) {
        setIsPickerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPickerOpen]);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset so the same file can be selected again
    e.target.value = '';
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) addFiles(files);
    },
    [addFiles],
  );

  const canSend =
    !disabled &&
    !isAnyUploading &&
    (input.trim().length > 0 || readyAttachmentIds.length > 0);

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
        className="w-full"
        aria-label="Command interface"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div
          className={cn(
            "liquid-glass flex flex-col rounded-xl border transition-all duration-300 overflow-visible",
            disabled ? 'opacity-30' : 'opacity-100',
            isFocused 
              ? 'border-accent/50 shadow-[0_8px_32px_rgba(203,166,247,0.15)] ring-1 ring-accent/30' 
              : 'border-border/30 shadow-[0_8px_32px_rgba(0,0,0,0.5)]'
          )}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Input row */}
          <div className="flex w-full items-start gap-3 px-5 pt-5 pb-4">
            <button
              type="button"
              disabled={disabled}
              onClick={handleAttachClick}
              className="text-text-muted hover:text-accent hover:bg-accent/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40"
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
                setInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
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
                disabled
                  ? sessionData?.session.status === 'running'
                    ? 'Agent is thinking...'
                    : 'Processing...'
                  : placeholder
              }
              aria-label="Command input"
              className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full resize-none border-none bg-transparent pt-[3px] p-0 font-sans text-[15px] leading-relaxed focus:ring-0 focus:outline-none outline-none"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              disabled={disabled}
            />
          </div>

            {/* Attachment strip — only visible when there are files */}
            {attachments.length > 0 && (
              <>
                <div className="mx-5 h-px bg-border/20" />
                <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
              </>
            )}

            {/* Hairline separator anchors toolbar below input */}
            <div className="mx-5 h-px bg-border/20" />

            {/* Toolbar row */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={isLoadingSession}
                        aria-label="Select AI provider"
                        aria-expanded={isPickerOpen}
                        className={cn(
                          "flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent",
                          isPickerOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5 text-text-muted hover:text-text-main',
                          isLoadingSession && "opacity-50 pointer-events-none"
                        )}
                      >
                        {isLoadingSession ? (
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                        ) : activeProvider?.icon ? (
                          <img src={activeProvider.icon} alt="" className="h-3.5 w-3.5 object-contain" />
                        ) : (
                          <Zap className={cn("h-3.5 w-3.5 transition-all duration-200", isPickerOpen && "fill-accent")} />
                        )}
                        <span className="max-w-[120px] truncate text-[10px] font-bold tracking-widest uppercase">
                          {isLoadingSession || isLoadingProviders ? '...' : (propSelectedModelId ?? selectedProviderLabel)}
                        </span>
                        <ChevronDown
                          className={cn("h-3 w-3 transition-transform duration-200", isPickerOpen && "rotate-180")}
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="top"
                      sideOffset={8}
                      className="w-[480px] p-0 overflow-hidden rounded-xl border-border/30"
                    >
                      <ProviderPicker
                        sessionId={sessionId}
                        isOpen={isPickerOpen}
                        onClose={() => {
                          setIsPickerOpen(false);
                        }}
                        providers={providers}
                        selectedId={resolvedId}
                        selectedModelId={propSelectedModelId ?? null}
                        onSelect={handleProviderSelect}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                 {isLoadingSession ? (
                   <div className="flex h-8 items-center gap-1.5 rounded-full border border-transparent px-3 text-text-muted/30">
                     <Shield className="h-3.5 w-3.5" />
                     <span className="text-[10px] font-bold tracking-widest uppercase">...</span>
                   </div>
                 ) : (
                   sessionData?.session && (
                     <CommandDropdown
                       value={sessionData.session.approvalMode}
                       disabled={isUpdatingApprovalMode}
                       variant="toolbar"
                       onChange={(val) => {
                         void setApprovalMode(val);
                       }}
                       icon={<Shield className="h-3.5 w-3.5" />}
                       options={[
                         { value: 'review', label: 'Review' },
                         { value: 'auto_approve', label: 'Auto Approve' },
                         { value: 'yolo', label: 'YOLO' },
                       ]}
                     />
                   )
                 )}

                <div className="bg-border/30 mx-2 h-4 w-px" />

                <MagicBar
                  files={reviewData.files}
                  onAction={(action) => {
                    onSend(action);
                  }}
                />
              </div>

              <Button
                size="sm"
                className={cn(
                  "group/send h-8 w-8 rounded-lg p-0 flex items-center justify-center transition-all duration-300 border-none",
                  canSend 
                    ? "visible opacity-100 translate-x-0 scale-100 bg-accent text-brand-crust hover:opacity-90 shadow-[0_0_20px_rgba(203,166,247,0.25)]" 
                    : "invisible opacity-0 translate-x-2 scale-90 pointer-events-none"
                )}
                onClick={handleSubmit}
                disabled={!canSend}
                aria-label="Execute command"
              >
                <ArrowUp className="h-4 w-4 stroke-[3]" />
              </Button>
            </div>
          </div>
        </form>
        {(isLoadingSession || sessionData?.session) && (
          <div className="text-text-muted mt-3 flex items-center justify-between px-2 text-[10px] font-bold tracking-widest opacity-60">
            {isLoadingSession ? (
              <div className="flex items-center gap-1.5 py-1 text-text-muted/30">
                <Monitor className="h-3.5 w-3.5" />
                <span>...</span>
              </div>
            ) : (
              <div className="flex items-center">
                <CommandDropdown
                  value={sessionData?.session.mode ?? 'local'}
                  disabled={isSwitchingMode}
                  onChange={(val) => {
                    void switchMode(val as 'local' | 'worktree');
                  }}
                  icon={<Monitor className="h-3.5 w-3.5" />}
                  options={[
                    { value: 'local', label: 'Local' },
                    ...(sessionData?.session.project?.repoRoot
                      ? [{ value: 'worktree', label: 'Worktree' }]
                      : []),
                  ]}
                />
              </div>
            )}

            {isLoadingSession ? (
              <div className="flex items-center gap-1.5 py-1 text-text-muted/30">
                <GitBranch className="h-3.5 w-3.5" />
                <span>...</span>
              </div>
            ) : (
              <CommandDropdown
                value={sessionData?.session.branch ?? ''}
                disabled={isSwitchingBranch}
                onChange={(val) => {
                  void switchBranch(val);
                }}
                icon={<GitBranch className="h-3.5 w-3.5" />}
                align="end"
                options={[
                  ...branches.map((b) => ({
                    value: b,
                    label: formatBranchName(b),
                  })),
                  ...(sessionData?.session.branch && (branches.length === 0 || !branches.includes(sessionData.session.branch))
                    ? [{ value: sessionData.session.branch, label: formatBranchName(sessionData.session.branch) }]
                    : []),
                ]}
              />
            )}
          </div>
        )}
      </div>
  );
}
