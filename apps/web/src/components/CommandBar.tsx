import { useState, useRef, useEffect } from 'react';
import { Send, Command, ChevronUp, ShieldCheck, Zap, Layers } from 'lucide-react';
import { HarnessPicker } from './HarnessPicker.js';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import type { DriverDiscovery } from '@agentctl/shared';

interface ControlBarProps {
  onSend: (val: string) => void;
  disabled?: boolean;
  selectedHarnessId?: string | null;
  onHarnessSelect?: (id: string) => void;
}

export function CommandBar({ 
  onSend, 
  disabled, 
  selectedHarnessId: propSelectedHarnessId,
  onHarnessSelect 
}: ControlBarProps) {
  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [internalSelectedHarnessId, setInternalSelectedHarnessId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const selectedId = propSelectedHarnessId ?? internalSelectedHarnessId;

  const { data: drivers = [] } = useQuery({
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
    <div className="px-4 pb-6 pt-2 bg-gradient-to-t from-background via-background/80 to-transparent relative z-40">
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
          <div className="absolute -inset-0.5 bg-accent/20 rounded-2xl blur-lg group-focus-within:bg-accent/30 transition-all duration-500 opacity-0 group-focus-within:opacity-100"></div>
          
          <div className={`relative flex flex-col bg-surface/90 backdrop-blur-xl border border-border/50 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.4)] transition-all duration-300 group-focus-within:border-accent/40 ${disabled ? 'opacity-50' : ''}`}>
            
            {/* Input Segment */}
            <div className="flex items-end p-1.5">
              <div className="p-2.5 text-text-muted">
                <Command className="w-4 h-4" />
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
                placeholder={disabled ? "Agent is busy..." : "Ask Gemini to build something..."}
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 px-1 text-[14px] leading-relaxed max-h-60 min-w-0 placeholder:text-text-muted/50 selection:bg-accent/30"
                disabled={disabled}
              />
              <button 
                onClick={handleSubmit}
                className={`p-2.5 m-1 rounded-xl transition-all duration-200 ${input.trim() && !disabled ? 'bg-accent text-background hover:scale-105 active:scale-95 shadow-[0_4px_12px_rgba(59,130,246,0.3)]' : 'text-text-muted'}`}
                disabled={!input.trim() || disabled}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            
            {/* Multi-Segment Control Area */}
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/30 bg-background/20 rounded-b-2xl">
              <div className="flex items-center gap-1">
                
                {/* Harness Selector Segment */}
                <button 
                  onClick={() => {
                    setIsPickerOpen(!isPickerOpen);
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all hover:bg-surface-hover group ${isPickerOpen ? 'bg-surface-hover text-accent' : 'text-text-muted'}`}
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <Zap className={`w-3.5 h-3.5 ${selectedId ? 'text-accent fill-accent/20' : 'text-text-muted'}`} />
                  </div>
                  <span className="text-[11px] font-bold tracking-tight truncate max-w-[120px]">
                    {selectedDriver.label}
                  </span>
                  <ChevronUp className={`w-3 h-3 transition-transform duration-300 ${isPickerOpen ? 'rotate-180' : ''}`} />
                </button>

                <div className="w-px h-4 bg-border/40 mx-1" />

                {/* Action Segment (Context Sensitive) */}
                <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover transition-all">
                  <Layers className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold tracking-tight">Build</span>
                  <ChevronUp className="w-3 h-3 opacity-30" />
                </button>

                <div className="w-px h-4 bg-border/40 mx-1" />

                {/* Access/Privacy Segment */}
                <button className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover transition-all">
                  <ShieldCheck className="w-3.5 h-3.5 text-success/70" />
                  <span className="text-[11px] font-bold tracking-tight uppercase">Full access</span>
                  <ChevronUp className="w-3 h-3 opacity-30" />
                </button>
              </div>

              {/* Status/Shortcuts */}
              <div className="flex items-center gap-4 text-[10px] text-text-muted/60 font-bold px-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-1 h-1 bg-success rounded-full" />
                  ONLINE
                </div>
                <div className="hidden sm:flex items-center gap-1.5">
                  <kbd className="bg-surface/50 px-1 py-0.5 rounded border border-border/50 text-[9px]">Ctrl+K</kbd>
                  <span>COMMANDS</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
