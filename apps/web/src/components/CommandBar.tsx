import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Zap, Paperclip } from 'lucide-react';
import { HarnessPicker } from './HarnessPicker.js';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import type { DriverDiscovery } from '@agentctl/shared';

interface ControlBarProps {
  onSend: (val: string) => void;
  disabled?: boolean;
  selectedHarnessId?: string | null;
  onHarnessSelect?: (id: string) => void;
  placeholder?: string;
}

export function CommandBar({ 
  onSend, 
  disabled, 
  selectedHarnessId: propSelectedHarnessId,
  onHarnessSelect,
  placeholder = "Ask Gemini to build something..."
}: ControlBarProps) {
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedHarnessId, setInternalSelectedHarnessId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const selectedId = propSelectedHarnessId ?? internalSelectedHarnessId;

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers'],
    queryFn: () => apiClient.fetch<DriverDiscovery[]>('/api/drivers'),
  });

  const selectedDriver = drivers.find((d) => d.id === selectedId);
  const selectedDriverLabel = selectedDriver !== undefined ? selectedDriver.label : 'Select harness';

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
    }
  };

  const handleHarnessSelect = (id: string) => {
    if (onHarnessSelect) {
      onHarnessSelect(id);
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

  // Handle escape to close picker
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
        
        {/* Harness Picker Popover */}
        <HarnessPicker 
          isOpen={isPickerOpen}
          onClose={() => {
            setIsPickerOpen(false);
          }}
          drivers={drivers}
          selectedId={selectedId ?? (drivers[0]?.id ?? null)}
          onSelect={handleHarnessSelect}
        />

        {/* The Control Bar */}
        <div className="relative group max-w-3xl mx-auto">
          {/* Breathing glow effect */}
          <div className="absolute -inset-1 bg-[var(--color-accent-glow)] rounded-full blur-xl animate-pulse opacity-40 group-focus-within:opacity-80 transition-opacity duration-700 pointer-events-none" />
          
          <div className={`relative flex items-center bg-surface/80 backdrop-blur-2xl border border-border/40 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-300 group-focus-within:border-accent/40 group-focus-within:shadow-[0_0_20px_var(--color-accent-glow)] ${disabled ? 'opacity-50' : ''}`}>
            
            {/* Input Area */}
            <div className="flex items-center w-full p-1.5 pl-3">
              <div className="flex items-center flex-shrink-0">
                {/* Harness Selector Segment */}
                <button 
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  title={selectedDriverLabel}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all hover:bg-background/80 group ${isPickerOpen ? 'bg-background/80 text-accent' : 'text-text-muted'}`}
                >
                  <div className="w-5 h-5 flex items-center justify-center">
                    <Zap className={`w-4 h-4 ${selectedId ? 'text-accent fill-accent/20' : 'text-text-muted'}`} />
                  </div>
                  <span className="text-[13px] font-bold tracking-tight truncate max-w-[100px] hidden sm:block">
                    {isLoading ? '...' : selectedDriverLabel}
                  </span>
                  <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-300 ${isPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className="w-px h-5 bg-border/40 mx-2" />
              </div>

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
                placeholder={disabled ? "Processing..." : placeholder}
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 px-2 text-[14px] leading-relaxed max-h-32 min-w-0 placeholder:text-text-muted/50 selection:bg-accent/30 self-center items-center"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                disabled={disabled}
              />
              
              <div className="flex items-center flex-shrink-0 gap-1 ml-1 pr-1">
                {/* File Attachment / Quick Actions */}
                <button 
                  className="p-2 text-text-muted/60 hover:text-text-muted hover:bg-background/50 rounded-full transition-colors duration-200"
                  title="Attach file"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <button 
                  onClick={handleSubmit}
                  className={`p-2.5 rounded-full transition-all duration-200 ${input.trim() && !disabled ? 'bg-accent text-white hover:scale-105 active:scale-95 shadow-[0_0_15px_var(--color-accent-glow)]' : 'text-text-muted/40 hover:text-text-muted/80 bg-background/50'}`}
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
