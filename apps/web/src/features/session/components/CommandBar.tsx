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
  placeholder = 'INPUT_COMMAND...',
}: ControlBarProps) {
  const { sessionId } = useSession();
  const { drivers, isLoadingDrivers } = useDrivers(sessionId);
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedHarnessId, setInternalSelectedHarnessId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedId = propSelectedHarnessId ?? internalSelectedHarnessId;

  const firstId = drivers[0]?.id ?? null;
  const resolvedId = selectedId ?? firstId;
  const activeDriver = drivers.find((d) => d.id === resolvedId);
  const selectedDriverLabel =
    activeDriver !== undefined ? activeDriver.label : 'Select harness';

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
    <div className="relative z-40 w-full px-6 pt-2 pb-6">
      <div className="relative max-w-[1200px] pl-10 pr-6 lg:pl-16">
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

          <form 
            className="w-full"
            aria-label="Command interface"
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          >
          <div
            className={`terminal-glass flex flex-col rounded-xl border border-border/40 shadow-2xl transition-all duration-500 bg-surface-secondary/20 backdrop-blur-2xl ${disabled ? 'opacity-30' : ''}`}
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
                placeholder={disabled ? 'PROCESSING...' : placeholder}
                aria-label="Command input"
                className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main max-h-48 min-h-[48px] w-full resize-none border-none bg-transparent px-3 py-2 text-[14px] leading-relaxed focus:ring-0 text-text-main"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            <div className="border-border/30 flex items-center justify-between border-t px-3 py-2.5 bg-surface-secondary/10">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  aria-label="Select AI harness"
                  aria-expanded={isPickerOpen}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-all duration-300 border ${isPickerOpen ? 'bg-accent text-background border-accent shadow-[0_0_15px_rgba(203,166,247,0.3)]' : 'hover:bg-surface-tertiary text-text-muted hover:text-text-main border-transparent'}`}
                >
                  {activeDriver?.icon ? (
                    <img src={activeDriver.icon} alt="" className="h-3.5 w-3.5 object-contain" />
                  ) : (
                    <Zap className={`h-3.5 w-3.5 ${isPickerOpen ? 'fill-background' : 'fill-none'}`} />
                  )}
                  <span className="max-w-[140px] truncate text-[10px] font-accent font-black uppercase tracking-[0.15em]">
                    {isLoadingDrivers ? '...' : (propSelectedModelId ?? selectedDriverLabel)}
                  </span>
                  <ChevronUp
                    className={`h-3.5 w-3.5 transition-transform duration-500 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-text-muted hover:text-accent transition-all p-1.5 hover:bg-accent/10 rounded-full"
                  title="Attach file"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <button
                  type="submit"
                  onClick={handleSubmit}
                  aria-label="Execute command"
                  className={`terminal-button flex items-center gap-2 !h-9 !px-5 !rounded-lg !bg-accent !text-background hover:scale-[1.02] active:scale-[0.98] ${input.trim() && !disabled ? 'shadow-[0_0_20px_rgba(203,166,247,0.4)]' : 'opacity-20 grayscale'}`}
                  disabled={!input.trim() || disabled}
                >
                  <span className="text-[10px] font-accent font-black tracking-widest text-background">EXECUTE</span>
                  <Send className="h-3.5 w-3.5 text-background" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

