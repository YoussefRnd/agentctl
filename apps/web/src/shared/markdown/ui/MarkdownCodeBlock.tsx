import { useCopyFeedback } from '@/shared/hooks/useCopyFeedback';
import { useRef, type ComponentPropsWithoutRef } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@agentctl/ui';

export function MarkdownCodeBlock({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'pre'>) {
  const { copied, copy } = useCopyFeedback();
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = () => {
    if (!preRef.current) return;
    const text = preRef.current.innerText || '';
    copy(text);
  };

  return (
    <div className="group/code relative my-3 max-w-full min-w-0">
      <pre
        ref={preRef}
        tabIndex={0}
        role="region"
        aria-label="Code block"
        {...props}
        className={`focus-visible:ring-accent/40 max-w-full overflow-x-auto p-4 font-mono text-[12px] leading-relaxed focus-visible:ring-2 focus-visible:outline-none ${className ?? ''}`}
      >
        {children}
      </pre>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="bg-surface/90 pointer-events-none absolute top-2 right-2 h-7 gap-1.5 px-2 text-[11px] opacity-0 shadow-sm backdrop-blur-sm transition-[color,background-color,border-color,opacity,transform] group-focus-within/code:pointer-events-auto group-focus-within/code:opacity-100 group-hover/code:pointer-events-auto group-hover/code:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3 text-emerald-400" />
            <span className="font-medium text-emerald-400">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            <span>Copy code</span>
          </>
        )}
      </Button>
    </div>
  );
}
