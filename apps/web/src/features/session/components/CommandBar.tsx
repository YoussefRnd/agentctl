import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Zap, Paperclip, Monitor, GitBranch, ChevronDown } from 'lucide-react';
import { ProviderPicker } from './ProviderPicker';
import { useProviders } from '../../../hooks/useProviders';
import { useSession } from '../../../contexts/SessionContext';
import { MagicBar } from './MagicBar';

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
}

function CustomDropdown<T extends string>({
  value,
  options,
  onChange,
  disabled,
  icon,
  align = 'left',
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

  return (
    <div ref={dropdownRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="text-text-muted/60 hover:text-text-main flex cursor-pointer items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase transition-colors focus:outline-none disabled:opacity-50"
      >
        {icon}
        <span className="max-w-[150px] truncate">{activeOption?.label ?? value}</span>
        <ChevronDown
          className={`text-text-muted/50 h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
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
                className={`w-full rounded-lg px-3 py-2 text-left text-[10px] font-bold tracking-widest uppercase transition-colors duration-150 ${
                  opt.value === value
                    ? 'bg-accent/15 text-accent hover:bg-accent/20'
                    : 'text-text-muted/80 hover:text-text-main hover:bg-white/5'
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
  onSend: (val: string) => void;
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
  } = useSession();
  const { providers, isLoadingProviders } = useProviders(sessionId);
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedProviderId, setInternalSelectedProviderId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedId = propSelectedProviderId ?? internalSelectedProviderId;

  const firstId = providers[0]?.id ?? null;
  const resolvedId = selectedId ?? firstId;
  const activeProvider = providers.find((p) => p.id === resolvedId);
  const selectedProviderLabel =
    activeProvider !== undefined ? activeProvider.label : 'Select provider';

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
    }
  };

  const handleProviderSelect = (id: string, modelId?: string) => {
    if (onProviderSelect) {
      onProviderSelect(id, modelId);
    } else {
      setInternalSelectedProviderId(id);
    }
    setIsPickerOpen(false);
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
    }
  }, [input]);

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

        <form
          className="w-full"
          aria-label="Command interface"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div
            className={`glass-card border-border/30 bg-surface/60 flex flex-col overflow-hidden rounded-[32px] border shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-3xl transition-all duration-500 ${disabled ? 'opacity-30' : ''}`}
          >
            <div className="w-full p-5 pb-2">
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
                placeholder={
                  disabled
                    ? sessionData?.session.status === 'running'
                      ? 'Agent is thinking...'
                      : 'Processing...'
                    : placeholder
                }
                aria-label="Command input"
                className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 font-sans text-[15px] leading-relaxed focus:ring-0"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  aria-label="Select AI provider"
                  aria-expanded={isPickerOpen}
                  className={`flex h-10 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-300 ${isPickerOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5 text-text-muted hover:text-text-main'}`}
                >
                  {activeProvider?.icon ? (
                    <img src={activeProvider.icon} alt="" className="h-4 w-4 object-contain" />
                  ) : (
                    <Zap className={`h-4 w-4 ${isPickerOpen ? 'fill-accent' : 'fill-none'}`} />
                  )}
                  <span className="max-w-[120px] truncate text-[12px] font-bold tracking-tight uppercase">
                    {isLoadingProviders ? '...' : (propSelectedModelId ?? selectedProviderLabel)}
                  </span>
                  <ChevronUp
                    className={`h-4 w-4 transition-transform duration-500 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <div className="bg-border/20 mx-1 h-4 w-px" />

                <MagicBar
                  files={reviewData.files}
                  onAction={(action) => {
                    onSend(action);
                  }}
                />

                <button
                  type="button"
                  className="text-text-muted hover:text-accent hover:bg-accent/10 flex h-10 items-center gap-2 rounded-full px-3 transition-all"
                  title="Attach file"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-4 w-4" />
                  <span className="text-[11px] font-bold tracking-tight uppercase">Files</span>
                </button>
              </div>

              <button
                type="submit"
                onClick={handleSubmit}
                aria-label="Execute command"
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${input.trim() && !disabled ? 'bg-accent text-background shadow-[0_0_20px_rgba(203,166,247,0.4)] hover:scale-105 active:scale-95' : 'bg-surface-quaternary text-text-muted/40 cursor-not-allowed'}`}
                disabled={!input.trim() || disabled}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
        {sessionData?.session && (
          <div className="text-text-muted/40 mt-4 flex items-center justify-between px-4 text-[10px] font-bold tracking-widest">
            <div className="flex items-center gap-4">
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
