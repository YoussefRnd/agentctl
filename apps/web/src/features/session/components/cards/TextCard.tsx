import { memo, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ChevronDown, ChevronRight, Brain, Sparkles } from 'lucide-react';
import { useSession } from '../../../../contexts/SessionContext';

type Role = 'provider' | 'user' | 'thought';

interface TextCardProps {
  content: string;
  variant?: Role;
  isStreaming?: boolean;
  attachments?: {
    attachmentId: string;
    mimeType: string;
    filename: string;
    sizeBytes: number;
  }[];
}

export const TextCard = memo(function TextCard({
  content,
  variant = 'provider',
  isStreaming = false,
  attachments,
}: TextCardProps) {
  const [thoughtOpen, setThoughtOpen] = useState(true);
  const { sessionId } = useSession();

  // Auto-expand thoughts while streaming, but allow user to toggle after
  useEffect(() => {
    if (isStreaming && variant === 'thought') {
      setThoughtOpen(true);
    }
  }, [isStreaming, variant]);

  if (variant === 'user') {
    return (
      <div className="flex justify-end py-3">
        <div className="flex flex-col items-end gap-2 max-w-[85%] sm:max-w-[75%]">
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {attachments.map((att) => (
                <div key={att.attachmentId} className="group/img relative overflow-hidden rounded-xl border border-border bg-surface-secondary shadow-md transition-all duration-200 hover:border-accent/40">
                  <img
                    src={`/api/sessions/${sessionId}/attachments/${att.attachmentId}`}
                    alt={att.filename}
                    className="max-h-60 max-w-full object-contain rounded-xl"
                  />
                </div>
              ))}
            </div>
          )}
          {content && (
            <div className="text-text-main group relative rounded-2xl border border-border/80 bg-surface-secondary/60 px-4 py-3 text-[14px] leading-relaxed shadow-lg backdrop-blur-md transition-colors duration-200 hover:border-border">
              <div className="text-text-muted/40 absolute -top-5 right-2 text-[9px] font-black tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100 select-none">
                USER_INPUT
              </div>
              {content}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'thought') {
    return (
      <div className="group/thought relative mb-1 py-1">
        <button
          type="button"
          className={`flex items-center gap-2 rounded-xl px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase transition-all duration-200 ${
            isStreaming
              ? 'text-accent bg-accent/10 border border-accent/25'
              : 'text-text-muted/60 hover:text-text-muted hover:bg-surface-secondary border border-transparent'
          }`}
          onClick={() => {
            setThoughtOpen((v) => !v);
          }}
        >
          <Brain className={`h-3.5 w-3.5 ${isStreaming ? 'animate-pulse text-accent' : ''}`} />
          <span>{isStreaming ? 'Analyzing Context...' : 'Thinking Process'}</span>
          {thoughtOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {thoughtOpen && (
          <div
            role="region"
            aria-label="Thought details"
            className="animate-in fade-in slide-in-from-left-1 mt-2 border-l border-border/30 pl-4 duration-200"
          >
            <div className="prose prose-invert prose-pre:bg-surface-secondary/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md text-text-muted/70 max-w-none font-mono text-[12px] leading-relaxed tracking-tight italic select-text">
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
    <div className="group/provider relative py-3">
      <div className="flex items-start gap-4">
        <div className="mt-1 shrink-0">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary/50 transition-all duration-300 ${
              isStreaming ? 'border-accent/40 bg-accent/5' : 'group-hover/provider:border-border-hover'
            }`}
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

