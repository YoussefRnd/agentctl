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

import { MagicBar } from './MagicBar';

export function CommandBar({
 onSend,
 disabled,
 selectedHarnessId: propSelectedHarnessId,
 selectedModelId: propSelectedModelId,
 onHarnessSelect,
 placeholder = 'Ask for follow-up changes or attach images',
}: ControlBarProps) {
 const { sessionId, reviewData } = useSession();
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
  <div className="relative z-40 w-full px-6 pb-12">
   <div className="relative max-w-[1000px] mx-auto">
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
      className={`glass-card flex flex-col rounded-[32px] border border-border/30 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)] transition-all duration-500 bg-surface/60 backdrop-blur-3xl overflow-hidden ${disabled ? 'opacity-30' : ''}`}
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
        placeholder={disabled ? 'PROCESSING...' : placeholder}
        aria-label="Command input"
        className="placeholder:text-text-muted/30 selection:bg-accent/30 selection:text-text-main max-h-60 w-full resize-none border-none bg-transparent p-0 text-[15px] leading-relaxed focus:ring-0 text-text-main font-sans"
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
         aria-label="Select AI harness"
         aria-expanded={isPickerOpen}
         className={`flex items-center gap-2 rounded-full px-3 h-10 transition-all duration-300 border border-transparent ${isPickerOpen ? 'bg-accent/20 text-accent border-accent/30' : 'hover:bg-text-main/5 text-text-muted hover:text-text-main'}`}
        >
         {activeDriver?.icon ? (
          <img src={activeDriver.icon} alt="" className="h-4 w-4 object-contain" />
         ) : (
          <Zap className={`h-4 w-4 ${isPickerOpen ? 'fill-accent' : 'fill-none'}`} />
         )}
         <span className="max-w-[120px] truncate text-[12px] font-bold uppercase tracking-tight">
          {isLoadingDrivers ? '...' : (propSelectedModelId ?? selectedDriverLabel)}
         </span>
         <ChevronUp
          className={`h-4 w-4 transition-transform duration-500 ${isPickerOpen ? 'rotate-180' : ''}`}
         />
        </button>

        <div className="h-4 w-px bg-border/20 mx-1" />

        <MagicBar
          files={reviewData.files}
          onAction={(action) => {
            onSend(action);
          }}
        />

        <button
         type="button"
         className="text-text-muted hover:text-accent transition-all px-3 h-10 flex items-center gap-2 hover:bg-accent/10 rounded-full"
         title="Attach file"
         aria-label="Attach file"
        >
         <Paperclip className="h-4 w-4" />
         <span className="text-[11px] font-bold uppercase tracking-tight">Files</span>
        </button>
       </div>

       <button
        type="submit"
        onClick={handleSubmit}
        aria-label="Execute command"
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 ${input.trim() && !disabled ? 'bg-accent text-background shadow-[0_0_20px_rgba(203,166,247,0.4)] hover:scale-105 active:scale-95' : 'bg-surface-quaternary text-text-muted/40 cursor-not-allowed'}`}
        disabled={!input.trim() || disabled}
       >
        <Send className="h-4 w-4" />
       </button>
      </div>
     </div>
    </form>
   </div>
  </div>
 );
}
