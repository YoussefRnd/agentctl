import { memo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ChevronDown, ChevronRight, Brain, Sparkles } from 'lucide-react';

type Role = 'provider' | 'user' | 'thought';

interface TextCardProps {
  content: string;
  variant?: Role;
  isStreaming?: boolean;
}

export const TextCard = memo(function TextCard({
  content,
  variant = 'provider',
  isStreaming = false,
}: TextCardProps) {
  const [thoughtOpen, setThoughtOpen] = useState(true);

  // Auto-expand thoughts while streaming, but allow user to toggle after
  useEffect(() => {
    if (isStreaming && variant === 'thought') {
      setThoughtOpen(true);
    }
  }, [isStreaming, variant]);

  if (variant === 'user') {
    return (
      <div className="flex justify-end py-4">
        <div className="text-text-main group relative max-w-[85%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[14px] leading-relaxed shadow-2xl backdrop-blur-md sm:max-w-[70%]">
          <div className="text-text-muted/40 absolute -top-6 right-2 text-[10px] font-black tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100">
            USER_STATION
          </div>
          {content}
        </div>
      </div>
    );
  }

  if (variant === 'thought') {
    return (
      <div className="group relative mb-2 py-2">
        <button
          type="button"
          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase transition-all duration-300 ${
            isStreaming
              ? 'text-accent bg-accent/10'
              : 'text-text-muted/60 hover:text-text-muted hover:bg-white/5'
          }`}
          onClick={() => {
            setThoughtOpen((v) => !v);
          }}
        >
          <Brain className={`h-3.5 w-3.5 ${isStreaming ? 'animate-pulse' : ''}`} />
          <span>{isStreaming ? 'Analyzing Context...' : 'Thinking Process'}</span>
          {thoughtOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {thoughtOpen && (
          <div
            role="region"
            aria-label="Thought details"
            className="animate-in fade-in slide-in-from-left-2 mt-2 ml-4 border-l-2 border-white/5 pl-4 transition-all duration-500"
          >
            <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-muted/60 max-w-none font-mono text-[12px] leading-relaxed tracking-tight italic">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
              {isStreaming && (
                <span className="bg-accent/40 ml-1 inline-block h-3.5 w-1.5 animate-pulse align-middle" />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // provider (default)
  return (
    <div className="group relative py-4">
      <div className="flex items-start gap-4">
        <div className="mt-1 shrink-0">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all duration-500 ${isStreaming ? 'border-accent/40 bg-accent/5' : 'group-hover:border-white/20'}`}
          >
            <Sparkles
              className={`h-4 w-4 ${isStreaming ? 'text-accent animate-pulse' : 'text-text-muted'}`}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-main/90 selection:bg-accent/30 max-w-none text-[15px] leading-7 tracking-normal">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
            {isStreaming && (
              <span className="ml-1 inline-flex items-center gap-1">
                <span className="bg-accent h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                <span className="bg-accent h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                <span className="bg-accent h-1.5 w-1.5 animate-bounce rounded-full" />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
