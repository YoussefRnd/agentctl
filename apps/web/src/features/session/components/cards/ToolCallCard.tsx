import { useState, memo, type ReactElement } from 'react';
import {
  Terminal,
  ChevronRight,
  FileText,
  Search,
  Settings,
  AlertCircle,
  Check,
  Trash2,
  Diff,
  Files,
} from 'lucide-react';
import { StreamingDots, getToolMeta } from '@/shared';
import type { ACPEventToolCallData } from '@agentctl/shared';

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function getContextSnippet(name: string, args: Record<string, unknown>): string | undefined {
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
    return filePath || undefined;
  }

  if (name.includes('search') || name.includes('grep')) {
    const query =
      typeof args.Query === 'string'
        ? args.Query
        : typeof args.query === 'string'
          ? args.query
          : '';
    return query || undefined;
  }

  if (name.includes('command') || name.includes('shell') || name.includes('run')) {
    const cmd =
      typeof args.CommandLine === 'string'
        ? args.CommandLine
        : typeof args.command === 'string'
          ? args.command
          : '';
    return cmd || undefined;
  }

  return undefined;
}

function DiffBlock({ block }: { block: Record<string, unknown> }) {
  const path = typeof block.path === 'string' ? block.path : 'file';
  const oldText = typeof block.oldText === 'string' ? block.oldText : null;
  const newText = typeof block.newText === 'string' ? block.newText : '';

  return (
    <div className="border-border/20 overflow-hidden rounded-lg border bg-black/15">
      <div className="bg-surface-secondary/60 border-border/20 flex items-center gap-1.5 border-b px-3 py-1.5">
        <Diff className="text-accent h-3 w-3 shrink-0" />
        <span className="text-text-muted font-mono text-[10px] break-all">{path}</span>
      </div>
      <div className="no-scrollbar max-h-60 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {oldText && (
          <div className="whitespace-pre-wrap text-rose-400/80">
            {oldText
              .split('\n')
              .map((line) => `- ${line}`)
              .join('\n')}
          </div>
        )}
        {newText && (
          <div className="whitespace-pre-wrap text-emerald-400/80">
            {newText
              .split('\n')
              .map((line) => `+ ${line}`)
              .join('\n')}
          </div>
        )}
      </div>
    </div>
  );
}

function ContentBlock({ block }: { block: Record<string, unknown> }) {
  const type = block.type;

  if (type === 'diff') {
    return <DiffBlock block={block} />;
  }

  if (type === 'terminal') {
    return null;
  }

  const inner = block.content as { text?: string } | undefined;
  const text = typeof inner?.text === 'string' ? inner.text : '';
  if (text.length === 0) return null;

  return (
    <div className="text-text-muted/90 max-h-60 overflow-y-auto text-[12px] leading-relaxed whitespace-pre-wrap select-text">
      {text}
    </div>
  );
}

function LocationsView({ locations }: { locations: { path?: string; line?: number }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Files className="text-text-muted/60 h-3.5 w-3.5 shrink-0" />
      {locations.map((loc, i) => (
        <code
          key={`${loc.path || ''}:${String(loc.line ?? i)}`}
          className="bg-surface-secondary/70 text-text-main border-border/25 rounded-md border px-2 py-0.5 font-mono text-[10.5px] break-all select-all"
        >
          {loc.path}
          {typeof loc.line === 'number' ? `:${String(loc.line)}` : ''}
        </code>
      ))}
    </div>
  );
}

function RawOutputView({ rawOutput }: { rawOutput: unknown }) {
  let text: string;
  if (typeof rawOutput === 'string') {
    text = rawOutput;
  } else if (rawOutput !== null && rawOutput !== undefined) {
    text = JSON.stringify(rawOutput, null, 2);
  } else {
    return null;
  }
  if (text.length === 0) return null;

  return (
    <div className="border-border/20 overflow-hidden rounded-lg border bg-black/15">
      <div className="bg-surface-secondary/60 text-text-muted border-border/20 border-b px-3 py-1.5 text-[9px] font-bold tracking-wider uppercase">
        Output
      </div>
      <pre className="no-scrollbar max-h-60 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text">
        {text}
      </pre>
    </div>
  );
}

function hasToolCallDetails(call: ACPEventToolCallData): boolean {
  const contentBlocks = Array.isArray(call.content) ? call.content : [];
  if (
    contentBlocks.some(
      (b) =>
        b &&
        typeof b === 'object' &&
        ((b as Record<string, unknown>).type === 'diff' ||
          (b as Record<string, unknown>).type === 'terminal'),
    )
  )
    return true;
  return (call.locations?.length ?? 0) > 0 || call.rawOutput !== undefined;
}

function getBlockKey(block: Record<string, unknown>): string {
  if (typeof block.id === 'string') return block.id;
  if (typeof block.path === 'string') return `path-${block.path}`;
  if (typeof block.type === 'string') {
    const snippet = typeof block.newText === 'string' ? block.newText.slice(0, 16) : '';
    return `type-${block.type}-${snippet}`;
  }
  return JSON.stringify(block).slice(0, 32);
}

function ToolCallDetails({ call }: { call: ACPEventToolCallData }) {
  const contentBlocks = Array.isArray(call.content)
    ? (call.content as Record<string, unknown>[])
    : [];
  const locations = call.locations ?? [];
  const rawOutput = call.rawOutput;

  if (contentBlocks.length > 0) {
    const rendered: (ReactElement | null)[] = contentBlocks.map((block) => {
      const blockKey = getBlockKey(block);
      return <ContentBlock key={blockKey} block={block} />;
    });
    const anyRendered = rendered.some((el) => el !== null);
    if (anyRendered) {
      return (
        <div className="space-y-2.5">
          {rendered}
          {locations.length > 0 && <LocationsView locations={locations} />}
        </div>
      );
    }
  }

  if (locations.length > 0) {
    return <LocationsView locations={locations} />;
  }

  if (rawOutput !== undefined) {
    return <RawOutputView rawOutput={rawOutput} />;
  }

  return null;
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
  durationMs,
}: {
  tool: string;
  payload: ACPEventToolCallData;
  isStreaming?: boolean;
  durationMs?: number | null;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? isStreaming;

  const args = payload.arguments ?? {};
  const hasDetails = hasToolCallDetails(payload);

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

  const contextSnippet = getContextSnippet(tool, args);

  const toggle = () => {
    setUserToggled(!open);
  };

  return (
    <div data-font-ctx="terminal" className="group/tool w-full py-0.5">
      <div
        className={`overflow-hidden rounded-lg border transition-colors ${
          isFailed ? 'border-rose-500/25 bg-rose-500/5' : 'border-border/25 bg-surface-secondary/30'
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          disabled={!hasDetails}
          className="focus-visible:ring-accent/40 focus-visible:ring-offset-background flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left outline-none select-none focus-visible:ring-1 focus-visible:ring-offset-1 disabled:cursor-default"
        >
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

          {contextSnippet && (
            <span className="text-text-muted/55 min-w-0 flex-1 truncate font-mono text-[10.5px]">
              {contextSnippet}
            </span>
          )}

          <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            {isStreaming && <StreamingDots className="ml-0" />}
            {!isStreaming && isFailed && <AlertCircle className="h-3.5 w-3.5 text-rose-500" />}
            {!isStreaming && !isFailed && isPending && (
              <span className="bg-text-muted/40 h-1.5 w-1.5 rounded-full" />
            )}
            {!isStreaming && !isFailed && !isPending && (
              <Check className="text-brand-green h-3.5 w-3.5 shrink-0 stroke-[3]" />
            )}
            {!isStreaming && durationMs != null && durationMs > 0 && (
              <span className="text-text-muted/40 shrink-0 font-mono text-[10px] tabular-nums">
                {formatDuration(durationMs)}
              </span>
            )}
            {hasDetails ? (
              <ChevronRight
                className={`text-text-muted/40 group-hover/tool:text-text-main h-3 w-3 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                aria-hidden={true}
              />
            ) : null}
          </span>
        </button>

        {open && hasDetails && (
          <div className="border-border/20 border-t px-3 py-2.5">
            <ToolCallDetails call={payload} />
          </div>
        )}
      </div>
    </div>
  );
});
