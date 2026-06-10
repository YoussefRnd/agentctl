import { useState, memo, useEffect } from 'react';
import { Terminal, ChevronRight, ChevronDown, FileText, Search, Settings } from 'lucide-react';
import type { ACPEventToolCallData } from '@agentctl/shared';

function ToolArgumentsViewer({ name, args }: { name: string; args: Record<string, unknown> }) {
  if (name.includes('file') || name.includes('view') || name.includes('read') || name.includes('write')) {
    const filePath = typeof args.AbsolutePath === 'string' ? args.AbsolutePath : (typeof args.TargetFile === 'string' ? args.TargetFile : (typeof args.path === 'string' ? args.path : ''));
    const content = typeof args.CodeContent === 'string' ? args.CodeContent : (typeof args.ReplacementContent === 'string' ? args.ReplacementContent : '');

    return (
      <div className="space-y-2">
        {filePath && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <FileText className="h-3.5 w-3.5 text-accent/80" />
            <span className="text-text-muted">Target Path:</span>
            <code className="bg-surface-secondary text-text-main rounded-md px-1.5 py-0.5 font-mono text-[11px] border border-border/40 break-all">
              {filePath}
            </code>
          </div>
        )}
        {content && (
          <div className="border border-border/30 bg-surface-secondary/40 rounded-lg overflow-hidden mt-1">
            <div className="bg-surface-secondary border-b border-border/20 px-3 py-1 flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider">
              <span>Code Content</span>
            </div>
            <pre className="p-3 text-[11px] font-mono leading-relaxed text-text-main/90 overflow-x-auto whitespace-pre-wrap max-h-60 no-scrollbar">
              {content}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (name.includes('search') || name.includes('grep')) {
    const query = typeof args.Query === 'string' ? args.Query : (typeof args.query === 'string' ? args.query : '');
    const path = typeof args.SearchPath === 'string' ? args.SearchPath : '';

    return (
      <div className="space-y-2">
        {query && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Search className="h-3.5 w-3.5 text-accent/80" />
            <span className="text-text-muted">Search Query:</span>
            <code className="bg-surface-secondary text-text-main rounded-md px-1.5 py-0.5 font-mono text-[11px] border border-border/40">
              {query}
            </code>
          </div>
        )}
        {path && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-text-muted ml-5">Within Path:</span>
            <span className="text-text-main font-mono text-[11px] break-all">{path}</span>
          </div>
        )}
      </div>
    );
  }

  if (name.includes('command') || name.includes('shell') || name.includes('run')) {
    const cmd = typeof args.CommandLine === 'string' ? args.CommandLine : (typeof args.command === 'string' ? args.command : '');
    return (
      <div className="bg-surface-secondary/80 border border-border/40 rounded-lg p-3 font-mono text-[11px] leading-relaxed shadow-inner">
        <div className="flex items-center gap-2 text-accent/80 border-b border-border/20 pb-1.5 mb-2 font-sans text-[10px] font-bold uppercase tracking-wider">
          <Terminal className="h-3.5 w-3.5" />
          <span>Terminal Command</span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="text-accent/60 select-none">$</span>
          <span className="text-text-main/90 font-mono break-all">{cmd}</span>
        </div>
      </div>
    );
  }

  return (
    <pre className="text-text-muted border border-border/40 bg-surface-secondary/40 rounded-lg p-3 text-[11px] leading-tight overflow-x-auto">
      {JSON.stringify(args, null, 2)}
    </pre>
  );
}

export const ToolCallCard = memo(function ToolCallCard({
  tool,
  payload,
  isStreaming = false,
}: {
  tool: string;
  payload: ACPEventToolCallData;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Auto-expand tool calls while streaming/active, but allow user to toggle after
  useEffect(() => {
    if (isStreaming) {
      setOpen(true);
    }
  }, [isStreaming]);

  const args = payload.arguments ?? {};
  const argKeys = Object.keys(args).filter((k) => !['toolCallId', 'name'].includes(k));

  return (
    <div className="group/tool w-full py-1">
      <div
        className="flex cursor-pointer items-center gap-2 select-none"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <div className="bg-surface-secondary/40 border-border/60 hover:border-accent/40 hover:bg-surface-secondary/80 flex flex-1 items-center justify-between border rounded-xl px-4 py-2.5 transition-all duration-200 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent transition-transform duration-200 ${isStreaming ? 'scale-105' : 'group-hover/tool:scale-105'}`}>
              {tool.includes('command') || tool.includes('shell') || tool.includes('run') ? (
                <Terminal className="h-3.5 w-3.5" />
              ) : tool.includes('search') || tool.includes('grep') ? (
                <Search className="h-3.5 w-3.5" />
              ) : tool.includes('file') || tool.includes('view') || tool.includes('read') || tool.includes('write') ? (
                <FileText className="h-3.5 w-3.5" />
              ) : (
                <Settings className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-text-main text-[12px] font-medium tracking-tight">
                {tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <span className="text-text-muted/50 truncate text-[10px] tracking-tight">
                {argKeys.length > 0 ? argKeys.join(', ') : 'no arguments'}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-text-muted/40 group-hover/tool:text-text-main transition-colors">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 border-border/50 bg-surface-secondary/20 mt-2 rounded-xl border p-4 shadow-sm duration-200">
          <ToolArgumentsViewer name={tool} args={args} />
        </div>
      )}
    </div>
  );
});

