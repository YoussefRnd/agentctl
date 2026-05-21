import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Zap, Paperclip } from 'lucide-react';
import { HarnessPicker } from './HarnessPicker';
import { useDrivers } from '../../../hooks/useDrivers';
import { useSession } from '../../../contexts/SessionContext';

interface ControlBarProps {
  onSend: (val: string) => void;
  disabled?: boolean;
  selectedHarnessId?: string | null;
  selectedModelId?: string | null;
  onHarnessSelect?: (id: string, modelId?: string) => void;
  placeholder?: string;
}

export function CommandBar({
  onSend,
  disabled,
  selectedHarnessId: propSelectedHarnessId,
  selectedModelId: propSelectedModelId,
  onHarnessSelect,
  placeholder = 'Send a message to start the conversation...',
}: ControlBarProps) {
  const { sessionId } = useSession();
  const { drivers, isLoadingDrivers } = useDrivers(sessionId);
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedHarnessId, setInternalSelectedHarnessId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedId = propSelectedHarnessId ?? internalSelectedHarnessId;

  const selectedDriver = drivers.find((d) => d.id === selectedId);
  const firstId = drivers[0]?.id ?? null;
  const resolvedId = selectedId ?? firstId;
  const selectedDriverLabel =
    selectedDriver !== undefined ? selectedDriver.label : 'Select harness';

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
    }
  };

  const handleHarnessSelect = (id: string, modelId?: string) => {
    if (onHarnessSelect) {
      onHarnessSelect(id, modelId);
    } else {
      setInternalSelectedHarnessId(id);
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
    <div className="from-background via-background/80 relative z-40 w-full bg-gradient-to-t to-transparent px-4 pt-2 pb-6">
      <div className="relative mx-auto max-w-4xl">
        <HarnessPicker
          sessionId={sessionId}
          isOpen={isPickerOpen}
          onClose={() => {
            setIsPickerOpen(false);
          }}
          drivers={drivers}
          selectedId={resolvedId}
          selectedModelId={propSelectedModelId ?? null}
          onSelect={handleHarnessSelect}
          />

          <div className="group relative mx-auto max-w-3xl">
            <div className="pointer-events-none absolute -inset-1 animate-pulse rounded-3xl bg-accent-glow opacity-40 blur-xl transition-opacity duration-700 group-focus-within:opacity-80" />

          <div
            className={`bg-surface/80 border-border/40 group-focus-within:border-accent/40 relative flex flex-col rounded-3xl border shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl transition-all duration-300 group-focus-within:shadow-[0_0_20px_var(--color-accent-glow)] ${disabled ? 'opacity-50' : ''}`}
          >
            <div className="w-full p-3">
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
                placeholder={disabled ? 'Processing...' : placeholder}
                className="placeholder:text-text-muted/50 selection:bg-accent/30 max-h-48 min-h-15 w-full resize-none border-none bg-transparent px-3 py-2 text-[15px] leading-relaxed focus:ring-0"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between px-3 pt-1 pb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  title={propSelectedModelId ?? selectedDriverLabel}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${isPickerOpen ? 'bg-background/80 text-accent border-accent/20' : 'bg-background/40 hover:bg-background/80 text-text-muted hover:text-text-main border-transparent'}`}
                >
                  <div className="flex items-center justify-center">
                    <Zap
                      className={`h-4 w-4 ${selectedId ? 'text-accent fill-accent/20' : 'text-text-muted'}`}
                    />
                  </div>
                  <span className="max-w-50 truncate text-[12px] font-medium tracking-tight">
                    {isLoadingDrivers ? '...' : (propSelectedModelId ?? selectedDriverLabel)}
                  </span>
                  <ChevronUp
                    className={`h-3.5 w-3.5 opacity-50 transition-transform duration-300 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="text-text-muted/60 hover:text-text-main hover:bg-background/50 rounded-xl p-2 transition-colors duration-200"
                  title="Attach file"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <button
                  onClick={handleSubmit}
                  className={`flex items-center justify-center rounded-xl p-2 transition-all duration-300 ${input.trim() && !disabled ? 'from-accent to-accent-hover bg-linear-to-r text-white shadow-[0_0_20px_var(--color-accent-glow)] hover:-translate-y-0.5 active:translate-y-0' : 'text-text-muted/40 hover:text-text-muted/80 bg-background/50'}`}
                  disabled={!input.trim() || disabled}
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
