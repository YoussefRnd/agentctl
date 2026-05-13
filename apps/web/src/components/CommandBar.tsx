import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

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
    <div className="p-4 bg-gradient-to-t from-background to-transparent pointer-events-none">
      <div className="max-w-3xl mx-auto relative group pointer-events-auto">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-accent to-purple-600 rounded-xl blur opacity-20 group-focus-within:opacity-40 transition duration-500"></div>
        <div className="relative flex items-end bg-surface/80 backdrop-blur-md border border-border rounded-xl p-2 shadow-2xl">
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
            placeholder="Type a command..."
            className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2 px-3 text-sm max-h-48 scrollbar-hide"
            disabled={disabled}
          />
          <button 
            onClick={handleSubmit}
            className="p-2 text-accent hover:text-white disabled:opacity-50 transition-colors"
            disabled={!input.trim() || disabled}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
