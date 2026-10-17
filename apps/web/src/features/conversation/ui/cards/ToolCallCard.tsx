import {
  ToolDiffBlock as DiffBlock,
  ToolLocations as LocationsView,
  ToolOutput,
} from '@/shared/transcript';
import { useState, useEffect, useRef, memo, type ReactElement } from 'react';
import {
  Terminal,
  ChevronRight,
  FileText,
  Search,
  Settings,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { StreamingDots, getToolMeta } from '@/shared';
import type { SessionEventToolCallData } from '@agentctl/shared';

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${String(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function getContextSnippet(name: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.CommandLine === 'string') return args.CommandLine;
  if (typeof args.command === 'string') return args.command;
  if (typeof args.cmd === 'string') return args.cmd;
  if (typeof args.AbsolutePath === 'string') return args.AbsolutePath;
  if (typeof args.TargetFile === 'string') return args.TargetFile;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.filePath === 'string') return args.filePath;
  if (typeof args.file === 'string') return args.file;
  if (typeof args.Query === 'string') return args.Query;
  if (typeof args.query === 'string') return args.query;
  if (typeof args.Pattern === 'string') return args.Pattern;
  if (typeof args.pattern === 'string') return args.pattern;
  return undefined;
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
    <div
      role="region"
      aria-label="Tool response"
      tabIndex={0}
      className="text-text-muted/90 focus-visible:ring-accent/40 max-h-60 min-w-0 overflow-y-auto text-[12px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap select-text focus-visible:ring-2 focus-visible:outline-none"
    >
      {text}
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
    <div className="bg-surface-secondary/30 border-border/15 overflow-hidden rounded-md border">
      <div className="bg-surface-secondary/40 text-text-muted border-border/15 border-b px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase">
        Output
      </div>
      <ToolOutput>{text}</ToolOutput>
    </div>
  );
}

function hasToolCallDetails(call: SessionEventToolCallData): boolean {
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

function ToolCallDetails({ call }: { call: SessionEventToolCallData }) {
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
        <div className="space-y-2">
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
  payload: SessionEventToolCallData;
  isStreaming?: boolean;
  durationMs?: number | null;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
      const interval = setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedMs(Date.now() - startTimeRef.current);
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      startTimeRef.current = null;
    }
  }, [isStreaming]);

  const open = userToggled ?? isStreaming;

  const args = payload.arguments ?? {};
  const hasDetails = hasToolCallDetails(payload);

  const status = payload.status;
  const isFailed = status === 'failed';
  const isPending = status === 'pending';

  const toolMeta = getToolMeta(payload.kind, tool);

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
        className={`overflow-hidden rounded-md border transition-colors ${
          isFailed
            ? 'border-rose-500/25 bg-rose-500/5'
            : 'border-border/15 bg-surface-secondary/20 hover:border-border/30 hover:bg-surface-secondary/35'
        }`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          disabled={!hasDetails}
          className="focus-visible:ring-accent/40 flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left outline-none select-none focus-visible:ring-1 disabled:cursor-default"
        >
          {isFailed ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
          ) : (
            <ToolIcon
              icon={toolMeta.icon}
              className="text-text-muted/60 group-hover/tool:text-text-main h-3.5 w-3.5 shrink-0 transition-colors"
            />
          )}

          <span className="text-text-main/90 truncate text-[11px] font-semibold tracking-tight">
            {titleText}
          </span>

          {contextSnippet && (
            <span className="text-text-muted/50 min-w-0 flex-1 truncate font-mono text-[10.5px]">
              {contextSnippet}
            </span>
          )}

          <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            {isStreaming && (
              <span className="text-accent flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
                <StreamingDots className="ml-0" />
                {elapsedMs > 0 && <span>{formatDuration(elapsedMs)}</span>}
              </span>
            )}
            {!isStreaming && isPending && (
              <span className="bg-text-muted/30 h-1.5 w-1.5 rounded-full" />
            )}
            {!isStreaming && durationMs != null && durationMs > 0 && (
              <span className="text-text-muted/40 shrink-0 font-mono text-[10px] tabular-nums">
                {formatDuration(durationMs)}
              </span>
            )}
            {hasDetails ? (
              <ChevronRight
                className={`text-text-muted/30 group-hover/tool:text-text-muted/70 h-3 w-3 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
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
