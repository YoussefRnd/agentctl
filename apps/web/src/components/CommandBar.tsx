import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Zap } from 'lucide-react';
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

  const selectedDriver = drivers.find((d) => d.id === selectedId) ?? drivers[0];

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
        <div className="relative group">
          {/* Subtle glow effect */}
          <div className="absolute -inset-0.5 bg-accent/10 rounded-2xl blur-lg group-focus-within:bg-accent/20 transition-all duration-500 opacity-0 group-focus-within:opacity-100"></div>
          
          <div className={`relative flex flex-col bg-surface/80 backdrop-blur-xl border border-border/40 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-300 group-focus-within:border-accent/30 ${disabled ? 'opacity-50' : ''}`}>
            
            {/* Input Area */}
            <div className="flex items-end p-2">
              <div className="flex items-center">
                {/* Harness Selector Segment */}
                <button 
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all hover:bg-background/50 group ${isPickerOpen ? 'bg-background/50 text-accent' : 'text-text-muted'}`}
                >
                  <div className="w-5 h-5 flex items-center justify-center">
                    <Zap className={`w-4 h-4 ${selectedId ? 'text-accent fill-accent/20' : 'text-text-muted'}`} />
                  </div>
                  <span className="text-[13px] font-bold tracking-tight truncate max-w-[140px]">
                    {isLoading ? '...' : selectedDriver.label}
                  </span>
                  <ChevronUp className={`w-4 h-4 transition-transform duration-300 ${isPickerOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className="w-px h-6 bg-border/30 mx-2" />
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
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 px-2 text-[14px] leading-relaxed max-h-60 min-w-0 placeholder:text-text-muted/40 selection:bg-accent/30"
                disabled={disabled}
              />
              
              <button 
                onClick={handleSubmit}
                className={`p-2.5 m-1 rounded-full transition-all duration-200 ${input.trim() && !disabled ? 'bg-accent text-background hover:scale-105 active:scale-95 shadow-lg' : 'text-text-muted/40 hover:text-text-muted'}`}
                disabled={!input.trim() || disabled}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
