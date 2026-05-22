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
    <div className="relative z-40 w-full bg-black px-4 pt-1 pb-4">
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

          <form 
            className="mx-auto max-w-3xl"
            aria-label="Command interface"
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          >
          <div
            className={`terminal-glass flex flex-col rounded-sm transition-all duration-300 ${disabled ? 'opacity-30' : ''}`}
          >
            <div className="w-full p-2">
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
                className="placeholder:text-text-muted/20 selection:bg-white selection:text-black max-h-48 min-h-[40px] w-full resize-none border-none bg-black px-2 py-1.5 text-[13px] leading-tight focus:ring-0"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
            </div>

            <div className="border-white/5 flex items-center justify-between border-t px-2 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  aria-label="Select AI harness"
                  aria-expanded={isPickerOpen}
                  className={`flex items-center gap-2 rounded-sm px-2 py-1 transition-all ${isPickerOpen ? 'bg-white text-black' : 'hover:bg-white/5 text-text-muted hover:text-white'}`}
                >
                  <Zap className={`h-3 w-3 ${isPickerOpen ? 'fill-black' : 'fill-none'}`} />
                  <span className="max-w-[120px] truncate text-[10px] font-black uppercase tracking-widest">
                    {isLoadingDrivers ? '...' : (propSelectedModelId ?? selectedDriverLabel)}
                  </span>
                  <ChevronUp
                    className={`h-3 w-3 transition-transform duration-300 ${isPickerOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-text-muted hover:text-white transition-colors"
                  title="Attach file"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>

                <button
                  type="submit"
                  onClick={handleSubmit}
                  aria-label="Execute command"
                  className={`terminal-button flex items-center gap-1.5 ${input.trim() && !disabled ? '' : 'opacity-20 grayscale'}`}
                  disabled={!input.trim() || disabled}
                >
                  <span className="text-[10px] font-black">EXECUTE</span>
                  <Send className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

