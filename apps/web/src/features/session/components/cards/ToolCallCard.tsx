import { useState, memo, useEffect } from 'react';
import {
  Terminal,
  ChevronRight,
  FileText,
  Search,
  Settings,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { getToolMeta } from '@/utils/toolColors';
import type { ACPEventToolCallData } from '@agentctl/shared';
import { Card } from '@agentctl/ui';

function ToolArgumentsViewer({ name, args }: { name: string; args: Record<string, unknown> }) {
  if (
    name.includes('file') ||
    name.includes('view') ||
    name.includes('read') ||
    name.includes('write')
  ) {
    const filePath =
      typeof args.AbsolutePath === 'string'
        ? args.AbsolutePath
        : typeof args.TargetFile === 'string'
          ? args.TargetFile
          : typeof args.path === 'string'
            ? args.path
            : '';
    const content =
      typeof args.CodeContent === 'string'
        ? args.CodeContent
        : typeof args.ReplacementContent === 'string'
          ? args.ReplacementContent
          : '';

    return (
      <div className="space-y-2">
        {filePath && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <FileText className="text-brand-green/80 h-3.5 w-3.5" />
            <span className="text-text-muted/80">Target Path:</span>
            <code className="bg-surface-secondary/70 text-text-main border-border/30 rounded-md border px-2 py-0.5 font-mono text-[10.5px] break-all select-all">
              {filePath}
            </code>
          </div>
        )}
        {content && (
          <div className="border-border/25 bg-surface-secondary/20 mt-2 overflow-hidden rounded-xl border shadow-sm">
            <div className="bg-surface-secondary/60 border-border/20 text-text-muted flex items-center justify-between border-b px-3 py-1.5 text-[9px] font-bold tracking-wider uppercase">
              <div className="flex items-center gap-1 select-none">
                <span className="h-2 w-2 rounded-full bg-red-500/60" />
                <span className="h-2 w-2 rounded-full bg-yellow-500/60" />
                <span className="h-2 w-2 rounded-full bg-green-500/60" />
              </div>
              <span className="font-mono">Code Buffer</span>
            </div>
            <pre className="text-text-main/90 no-scrollbar max-h-60 overflow-x-auto bg-black/10 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
              {content}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (name.includes('search') || name.includes('grep')) {
    const query =
      typeof args.Query === 'string'
        ? args.Query
        : typeof args.query === 'string'
          ? args.query
          : '';
    const path = typeof args.SearchPath === 'string' ? args.SearchPath : '';

    return (
      <div className="space-y-2">
        {query && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Search className="text-brand-blue/80 h-3.5 w-3.5" />
            <span className="text-text-muted/80">Search Query:</span>
            <code className="bg-surface-secondary/70 text-text-main border-border/30 rounded-md border px-2 py-0.5 font-mono text-[10.5px] select-all">
              {query}
            </code>
          </div>
        )}
        {path && (
          <div className="flex flex-wrap items-center gap-2 pl-5.5 text-[11px]">
            <span className="text-text-muted/80">Within Path:</span>
            <span className="text-text-main font-mono text-[10.5px] break-all select-all">
              {path}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (name.includes('command') || name.includes('shell') || name.includes('run')) {
    const cmd =
      typeof args.CommandLine === 'string'
        ? args.CommandLine
        : typeof args.command === 'string'
          ? args.command
          : '';
    return (
      <div className="bg-surface-secondary/35 border-border/25 overflow-hidden rounded-xl border font-mono text-[11px] leading-relaxed shadow-sm">
        <div className="bg-surface-secondary/70 border-border/20 flex items-center justify-between border-b px-3.5 py-2">
          <div className="flex items-center gap-1 select-none">
            <span className="h-2 w-2 rounded-full bg-red-500/60" />
            <span className="h-2 w-2 rounded-full bg-yellow-500/60" />
            <span className="h-2 w-2 rounded-full bg-green-500/60" />
          </div>
          <div className="text-text-muted/80 flex items-center gap-1.5 font-sans text-[9px] font-bold tracking-wider uppercase">
            <Terminal className="text-brand-peach/90 h-3 w-3" />
            <span>Terminal</span>
          </div>
        </div>
        <div className="flex items-start gap-1.5 bg-black/10 p-3.5 select-text">
          <span className="text-brand-peach/60 font-bold select-none">$</span>
          <span className="text-text-main/90 font-mono break-all whitespace-pre-wrap">{cmd}</span>
        </div>
      </div>
    );
  }

  const keys = Object.keys(args).filter((k) => k !== 'toolCallId' && k !== 'name');
  if (keys.length > 0) {
    return (
      <div className="space-y-3.5 text-[11px] leading-relaxed">
        {keys.map((key) => {
          const val = args[key];
          const isLongValue = typeof val === 'string' && (val.length > 60 || val.includes('\n'));
          const keyLabel = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .trim()
            .toUpperCase();

          if (isLongValue) {
            return (
              <div key={key} className="space-y-1">
                <span className="text-text-muted/65 text-[9px] font-bold tracking-wider uppercase select-none">
                  {keyLabel}
                </span>
                <div className="border-border/20 overflow-hidden rounded-xl border bg-black/15 shadow-sm">
                  <pre className="text-text-main/90 overflow-x-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
                    {val}
                  </pre>
                </div>
              </div>
            );
          }

          const displayVal =
            typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
          return (
            <div key={key} className="flex flex-wrap items-baseline gap-2">
              <span className="text-text-muted/65 inline-block min-w-[100px] text-[9px] font-bold tracking-wider uppercase select-none">
                {keyLabel}:
              </span>
              <span className="bg-surface-secondary/40 text-text-main border-border/10 rounded border px-1.5 py-0.5 font-mono text-[10.5px] break-all select-all">
                {displayVal}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return <div className="text-text-muted/50 py-1 text-[11px] italic">No arguments provided</div>;
}

function ToolIcon({ icon, className }: { icon: string; className: string }) {
  if (icon === 'file') return <FileText className={className} />;
  if (icon === 'trash') return <Trash2 className={className} />;
  if (icon === 'search') return <Search className={className} />;
  if (icon === 'terminal') return <Terminal className={className} />;
  return <Settings className={className} />;
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

  const status = payload.status;
  const isFailed = status === 'failed';
  const isPending = status === 'pending';

  const toolMeta = getToolMeta(payload.kind, tool);

  let iconBgBorder = `${toolMeta.bgColor} ${toolMeta.borderColor} ${toolMeta.color}`;
  if (isFailed) {
    iconBgBorder = 'bg-rose-500/10 border-rose-500/20 text-rose-500';
  }

  const titleText =
    payload.title ??
    (tool.startsWith('call_') ? tool.substring(5) : tool)
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div data-font-ctx="terminal" className="group/tool w-full py-0.5">
      <button
        type="button"
        className="focus-visible:ring-accent/40 focus-visible:ring-offset-background flex w-full cursor-pointer items-center rounded-lg border-none bg-transparent text-left outline-none select-none focus-visible:ring-1 focus-visible:ring-offset-1"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Card
          status={isFailed ? 'error' : isPending ? 'pending' : 'default'}
          className="flex-1 flex-row items-center justify-between px-2.5 py-1.5 backdrop-blur-[1px]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-transform duration-200 ${isStreaming ? 'scale-105' : 'group-hover/tool:scale-105'} ${iconBgBorder}`}
            >
              {isFailed ? (
                <AlertCircle className="h-3 w-3 text-rose-500" />
              ) : (
                <ToolIcon icon={toolMeta.icon} className={`h-3 w-3 ${toolMeta.color}`} />
              )}
            </div>
            <span className="text-text-main truncate text-[11px] font-bold tracking-tight">
              {titleText}
            </span>
          </div>
          <div className="text-text-muted/40 group-hover/tool:text-text-main ml-2 shrink-0 transition-colors">
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            />
          </div>
        </Card>
      </button>

      {open && (
        <Card
          status={isFailed ? 'error' : 'default'}
          className="liquid-glass hover:border-border/20 mt-1.5 p-2.5"
        >
          <ToolArgumentsViewer name={tool} args={args} />
        </Card>
      )}
    </div>
  );
});
