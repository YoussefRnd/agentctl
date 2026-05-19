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
    <div className="px-4 pb-6 pt-2 bg-gradient-to-t from-background via-background/80 to-transparent relative z-40 w-full">
      <div className="max-w-4xl mx-auto relative">
        <HarnessPicker
          sessionId={sessionId}
          isOpen={isPickerOpen}
          onClose={() => {
            setIsPickerOpen(false);
          }}
          drivers={drivers}
          selectedId={selectedId ?? drivers[0]?.id ?? null}
          selectedModelId={propSelectedModelId ?? null}
          onSelect={handleHarnessSelect}
        />

        <div className="relative group max-w-3xl mx-auto">
          <div className="absolute -inset-1 bg-[var(--color-accent-glow)] rounded-3xl blur-xl animate-pulse opacity-40 group-focus-within:opacity-80 transition-opacity duration-700 pointer-events-none" />

          <div
            className={`relative flex flex-col bg-surface/80 backdrop-blur-2xl border border-border/40 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-300 group-focus-within:border-accent/40 group-focus-within:shadow-[0_0_20px_var(--color-accent-glow)] ${disabled ? 'opacity-50' : ''}`}
          >
            <div className="p-3 w-full">
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
                className="w-full bg-transparent border-none focus:ring-0 resize-none py-2 px-3 text-[15px] leading-relaxed max-h-48 min-h-[60px] placeholder:text-text-muted/50 selection:bg-accent/30"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  title={propSelectedModelId ?? selectedDriverLabel}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border ${isPickerOpen ? 'bg-background/80 text-accent border-accent/20' : 'bg-background/40 hover:bg-background/80 text-text-muted hover:text-text-main border-transparent'}`}
                >
                  <div className="flex items-center justify-center">
                    <Zap
                      className={`w-4 h-4 ${selectedId ? 'text-accent fill-accent/20' : 'text-text-muted'}`}
                    />
                  </div>
                  <span className="text-[12px] font-medium tracking-tight truncate max-w-[200px]">
                    {isLoadingDrivers ? '...' : (propSelectedModelId ?? selectedDriverLabel)}
                  </span>
                  <ChevronUp
                    className={`w-3.5 h-3.5 transition-transform duration-300 opacity-50 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="p-2 text-text-muted/60 hover:text-text-main hover:bg-background/50 rounded-xl transition-colors duration-200"
                  title="Attach file"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <button
                  onClick={handleSubmit}
                  className={`p-2 rounded-xl transition-all duration-200 flex items-center justify-center ${input.trim() && !disabled ? 'bg-accent text-white hover:scale-105 active:scale-95 shadow-[0_0_15px_var(--color-accent-glow)]' : 'text-text-muted/40 hover:text-text-muted/80 bg-background/50'}`}
                  disabled={!input.trim() || disabled}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
