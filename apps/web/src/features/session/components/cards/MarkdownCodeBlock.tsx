import { useState, useRef, type ComponentPropsWithoutRef } from 'react';
import { Copy, Check } from 'lucide-react';

export function MarkdownCodeBlock({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = () => {
    if (!preRef.current) return;
    const text = preRef.current.innerText || '';
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="group/code relative my-3">
      <pre
        ref={preRef}
        {...props}
        className={`overflow-x-auto p-4 font-mono text-[12px] leading-relaxed ${className ?? ''}`}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="border-border/40 bg-surface-primary/90 text-text-muted hover:bg-surface-secondary hover:text-text-main absolute top-2 right-2 flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-sans text-[11px] font-medium opacity-0 shadow-sm backdrop-blur-sm transition-all group-hover/code:opacity-100 focus-visible:opacity-100"
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
      </button>
    </div>
  );
}
