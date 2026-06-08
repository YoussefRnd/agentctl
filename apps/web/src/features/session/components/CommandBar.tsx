import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Zap, Monitor, GitBranch, ChevronDown, Shield, Plus } from 'lucide-react';
import { ProviderPicker } from './ProviderPicker';
import { useProviders } from '../../../hooks/useProviders';
import { useSession } from '../../../contexts/SessionContext';
import { MagicBar } from './MagicBar';
import { AttachmentStrip } from './AttachmentStrip';
import { useAttachments } from '../../../hooks/useAttachments';

interface DropdownOption<T> {
  value: T;
  label: string;
}

interface CustomDropdownProps<T> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  align?: 'left' | 'right';
  variant?: 'default' | 'toolbar';
}

function CustomDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  icon,
  align = 'left',
  variant = 'default',
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const activeOption = options.find((opt) => opt.value === value);

  const buttonClass = variant === 'toolbar'
    ? `flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-[color,background-color,border-color] duration-200 text-text-muted hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40 ${isOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5'}`
    : "text-text-muted/60 hover:text-text-main flex cursor-pointer items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase transition-[color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40";

  const textClass = variant === 'toolbar'
    ? "max-w-[150px] truncate text-[10px] font-bold tracking-widest uppercase"
    : "max-w-[150px] truncate";

  const chevronClass = variant === 'toolbar'
    ? `text-text-muted/50 h-3 w-3 motion-safe:transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`
    : `text-text-muted/50 h-3 w-3 motion-safe:transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`;

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className={buttonClass}
      >
        {icon}
        <span className={textClass}>{activeOption?.label ?? value}</span>
        <ChevronDown className={chevronClass} />
      </button>

      {isOpen && (
        <div
          className={`border-border/40 bg-surface-secondary/95 animate-in fade-in slide-in-from-bottom-2 absolute bottom-full z-50 mb-1.5 min-w-[140px] rounded-xl border p-1 shadow-xl shadow-black/40 backdrop-blur-md duration-150 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="flex flex-col gap-0.5">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-[10px] font-bold tracking-widest uppercase transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  opt.value === value
                    ? 'bg-accent/15 text-accent hover:bg-accent/20'
                    : 'text-text-muted/80 hover:text-text-main hover:bg-text-main/5'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
  } = useSession();
  const { providers, isLoadingProviders } = useProviders(sessionId);
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedProviderId, setInternalSelectedProviderId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { attachments, addFiles, removeAttachment, clearAll, readyAttachmentIds, isAnyUploading } =
    useAttachments(sessionId);

  const selectedId = propSelectedProviderId ?? internalSelectedProviderId;

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
      setInternalSelectedProviderId(id);
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
    <div className="relative z-40 w-full px-6 pb-4">
      <div className="relative mx-auto max-w-[1000px]">
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

        {/* Hidden file input */}
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
            className={`glass-card border-border/30 bg-surface/60 flex flex-col rounded-[2rem] border shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-3xl transition-opacity duration-300 ${disabled ? 'opacity-30' : 'opacity-100'}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {/* Input row */}
            <div className="flex w-full items-start gap-2.5 px-4 pt-4 pb-3">
              <button
                type="button"
                disabled={disabled}
                onClick={handleAttachClick}
                className="text-text-muted hover:text-accent hover:bg-accent/10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40"
                title="Attach image"
                aria-label="Attach image"
              >
                <Plus className="h-3.5 w-3.5" />
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
                onPaste={handlePaste}
                placeholder={
                  disabled
                    ? sessionData?.session.status === 'running'
                      ? 'Agent is thinking...'
                      : 'Processing...'
                    : placeholder
                }
                aria-label="Command input"
                className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 font-sans text-[15px] leading-relaxed focus:ring-0 focus:outline-none outline-none"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            {/* Attachment strip — only visible when there are files */}
            {attachments.length > 0 && (
              <>
                <div className="mx-4 h-px bg-border/20" />
                <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
              </>
            )}

            {/* Hairline separator anchors toolbar below input */}
            <div className="mx-4 h-px bg-border/20" />

            {/* Toolbar row */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  aria-label="Select AI provider"
                  aria-expanded={isPickerOpen}
                  className={`flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-[color,background-color,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${isPickerOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5 text-text-muted hover:text-text-main'}`}
                >
                  {activeProvider?.icon ? (
                    <img src={activeProvider.icon} alt="" className="h-3.5 w-3.5 object-contain" />
                  ) : (
                    <Zap className={`h-3.5 w-3.5 transition-[fill] duration-200 ${isPickerOpen ? 'fill-accent' : 'fill-none'}`} />
                  )}
                  <span className="max-w-[120px] truncate text-[10px] font-bold tracking-widest uppercase">
                    {isLoadingProviders ? '...' : (propSelectedModelId ?? selectedProviderLabel)}
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 motion-safe:transition-transform duration-200 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {sessionData?.session && (
                  <CustomDropdown
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
                )}

                <div className="bg-border/30 mx-1.5 h-3.5 w-px" />

                <MagicBar
                  files={reviewData.files}
                  onAction={(action) => {
                    onSend(action);
                  }}
                />
              </div>

              <button
                type="submit"
                onClick={handleSubmit}
                aria-label="Execute command"
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,box-shadow,transform,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-safe:hover:scale-105 motion-safe:active:scale-95 ${canSend ? 'bg-accent text-background shadow-[0_0_16px_rgba(203,166,247,0.35)]' : 'bg-surface-quaternary text-text-muted/40 cursor-not-allowed opacity-50'}`}
                disabled={!canSend}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </form>
        {sessionData?.session && (
          <div className="text-text-muted/35 mt-2 flex items-center justify-between px-1 text-[10px] font-bold tracking-widest">
            <div className="flex items-center">
              <CustomDropdown
                value={sessionData.session.mode}
                disabled={isSwitchingMode}
                onChange={(val) => {
                  void switchMode(val as 'local' | 'worktree');
                }}
                icon={<Monitor className="h-3.5 w-3.5" />}
                options={[
                  { value: 'local', label: 'Local' },
                  ...(sessionData.session.project?.repoRoot
                    ? [{ value: 'worktree', label: 'Worktree' }]
                    : []),
                ]}
              />
            </div>

            <CustomDropdown
              value={sessionData.session.branch}
              disabled={isSwitchingBranch}
              onChange={(val) => {
                void switchBranch(val);
              }}
              icon={<GitBranch className="h-3.5 w-3.5" />}
              align="right"
              options={[
                ...branches.map((b) => ({
                  value: b,
                  label: formatBranchName(b),
                })),
                ...(branches.length === 0 || !branches.includes(sessionData.session.branch)
                  ? [
                      {
                        value: sessionData.session.branch,
                        label: formatBranchName(sessionData.session.branch),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
