import { useState, useRef, useEffect } from 'react';
import { Send, Command } from 'lucide-react';

export function CommandBar({ onSend, disabled }: { onSend: (val: string) => void, disabled?: boolean }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${String(textareaRef.current.scrollHeight)}px`;
    }
  }, [input]);

  return (
    <div className="px-4 pb-6 pt-2 bg-gradient-to-t from-background via-background/80 to-transparent">
      <div className="max-w-3xl mx-auto relative group">
        {/* Subtle glow effect */}
        <div className="absolute -inset-0.5 bg-accent/20 rounded-2xl blur-lg group-focus-within:bg-accent/30 transition-all duration-500 opacity-0 group-focus-within:opacity-100"></div>
        
        <div className={`relative flex flex-col bg-surface border border-border rounded-2xl shadow-2xl transition-all duration-300 group-focus-within:border-accent/50 ${disabled ? 'opacity-50' : ''}`}>
          <div className="flex items-end p-2">
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
              className={`p-2.5 m-1 rounded-xl transition-all duration-200 ${input.trim() && !disabled ? 'bg-accent text-background hover:scale-105 active:scale-95' : 'text-text-muted'}`}
              disabled={!input.trim() || disabled}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          
          <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/50 text-[10px] text-text-muted font-medium uppercase tracking-wider">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <kbd className="bg-surface-hover px-1.5 py-0.5 rounded border border-border">Enter</kbd> to send
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="bg-surface-hover px-1.5 py-0.5 rounded border border-border">Shift + Enter</kbd> for new line
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
