import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Activity, CheckCircle2, Clock } from 'lucide-react';
import { TextCard } from './TextCard';
import { ToolCallCard } from './ToolCallCard';
import type { ACPEventRow } from '@agentctl/shared';

const TOOL_LABELS: Partial<Record<string, (args: Record<string, unknown>) => string>> = {
  read_file: (args) =>
    `Reading ${typeof args.path === 'string' ? (args.path.split('/').pop() ?? 'file') : 'file'}`,
  write_file: (args) =>
    `Writing ${typeof args.path === 'string' ? (args.path.split('/').pop() ?? 'file') : 'file'}`,
  grep_search: (args) => `Searching for "${typeof args.pattern === 'string' ? args.pattern : ''}"`,
  run_shell_command: (args) =>
    `Executing ${typeof args.command === 'string' ? (args.command.split(' ')[0] ?? 'command') : 'command'}`,
  list_directory: (args) =>
    `Listing ${typeof args.dir_path === 'string' ? args.dir_path : 'directory'}`,
  web_search: (args) => `Searching web for "${typeof args.query === 'string' ? args.query : ''}"`,
  web_fetch: (args) =>
    `Fetching ${typeof args.url === 'string' ? (args.url.split('/').pop() ?? 'webpage') : 'webpage'}`,
};

function getToolLabel(name: string, args: Record<string, unknown>) {
  const formatter = TOOL_LABELS[name];
  return formatter ? formatter(args) : `Executing ${name}`;
}

interface ActivityGroupProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
  layout?: 'standalone' | 'nested';
}

export function ActivityGroup({ events, isStreaming = false, layout = 'standalone' }: ActivityGroupProps) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  const { breadcrumbs, duration, totalTokens } = useMemo(() => {
    const steps: string[] = [];
    let hasThought = false;
    let computedDurationMs = 0;
    let tokens = 0;

    for (const e of events) {
      if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
        if (!hasThought) {
          steps.push('Thinking');
          hasThought = true;
        }
      } else if (e.type === 'tool_call') {
        const args = e.data.arguments ?? {};
        steps.push(getToolLabel(e.data.name, args));
      } else if (e.type === 'approval_request') {
        const reqData = e.data as { name?: string; request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } } };
        const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
        const args = reqData.request?.toolCall?.arguments ?? {};
        steps.push(getToolLabel(toolName, args));
      }

      if (e.metadata) {
        if (e.metadata.durationMs) {
          computedDurationMs += e.metadata.durationMs;
        }
        if (e.metadata.completionTokens) {
          tokens += e.metadata.completionTokens;
        }
      }
    }

    let durationStr = '';
    if (computedDurationMs > 0) {
      durationStr = computedDurationMs > 1000
        ? `${(computedDurationMs / 1000).toFixed(1)}s`
        : `${String(computedDurationMs)}ms`;
    } else {
      const start = events[0].createdAt;
      const end = events[events.length - 1].createdAt;
      const diff = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
      durationStr = diff > 1000 ? `${(diff / 1000).toFixed(1)}s` : `${String(diff)}ms`;
    }

    return { breadcrumbs: steps, duration: durationStr, totalTokens: tokens };
  }, [events]);

  if (layout === 'nested') {
    return (
      <div className="group/activity my-2">
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide transition-all duration-200 ${
            isOpen
              ? 'text-accent bg-accent/8 border border-accent/20'
              : 'text-text-muted/60 hover:text-text-muted hover:bg-surface-secondary border border-transparent'
          }`}
        >
          <Activity className={`h-3.5 w-3.5 ${isStreaming ? 'animate-pulse text-accent' : 'text-text-muted/60'}`} />
          <span>
            {isStreaming
              ? 'Running actions...'
              : `${String(breadcrumbs.length)} action${breadcrumbs.length !== 1 ? 's' : ''} in ${duration}${totalTokens > 0 ? ` (${String(totalTokens)} tokens)` : ''}`}
          </span>
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>

        {isOpen && (
          <div className="animate-in fade-in slide-in-from-left-2 mt-2 ml-3 flex flex-col gap-3 rounded-md bg-surface-secondary/20 px-3 py-2.5 duration-200">
            {events.map((e) => {
              const isLastStreaming = isStreaming && e.id === events[events.length - 1].id;
              if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
                return (
                  <div key={e.id} className="relative" role="region" aria-label="Agent thought step">
                    <div className={`absolute top-[18px] -left-[24px] h-2 w-2 rounded-full border transition-all duration-300 ${
                      isLastStreaming
                        ? 'bg-accent border-accent shadow-[0_0_4px_rgba(203,166,247,0.5)]'
                        : 'bg-surface-secondary border-border/80'
                    }`} />
                    <TextCard
                      content={e.data.content}
                      variant="thought"
                      isStreaming={isLastStreaming}
                    />
                  </div>
                );
              }
              if (e.type === 'tool_call' || e.type === 'approval_request') {
                const reqData = e.data as { name?: string; request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } } };
                const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
                const payload = (e.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : e.data) as { name: string; arguments?: Record<string, unknown> };
                return (
                  <div key={e.id} className="relative">
                    <div className={`absolute top-[20px] -left-[24px] h-2 w-2 rounded-full border transition-all duration-300 ${
                      isLastStreaming
                        ? 'bg-accent border-accent shadow-[0_0_4px_rgba(203,166,247,0.5)]'
                        : 'bg-surface-secondary border-border/80'
                    }`} />
                    <ToolCallCard
                      tool={toolName}
                      payload={payload}
                      isStreaming={isLastStreaming}
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group/activity my-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className={`flex grow items-center gap-4 rounded-lg border px-4 py-3 text-left transition-all duration-200 ${
            isOpen
              ? 'border-border/60 bg-surface-secondary/30'
              : 'border-border/40 bg-surface/40 hover:border-border/60 hover:bg-surface-secondary/20'
          }`}
        >
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all duration-200 ${
              isStreaming
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-success border border-border bg-surface-secondary/60'
            }`}
          >
            {isStreaming ? (
              <Activity className="h-3.5 w-3.5 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`text-[11px] font-semibold tracking-wide ${isStreaming ? 'text-accent' : 'text-text-main'}`}
              >
                {isStreaming ? 'Processing...' : 'Done'}
              </span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <div className="text-text-muted/50 flex items-center gap-1.5 text-[10px] tracking-wide">
                <Clock className="h-3 w-3" />
                <span>{duration}{totalTokens > 0 ? ` · ${String(totalTokens)} tokens` : ''}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-hidden">
              {breadcrumbs.map((step, i) => (
                <div key={i} className="flex shrink-0 items-center gap-2">
                  <span
                    className={`max-w-[200px] truncate text-[12px] font-medium ${
                      i === breadcrumbs.length - 1 && isStreaming ? 'text-text-main' : 'text-text-muted/60'
                    }`}
                  >
                    {step}
                  </span>
                  {i < breadcrumbs.length - 1 && (
                    <ChevronRight className="text-border/60 h-3 w-3" />
                  )}
                </div>
              ))}
              {isStreaming && <span className="text-accent/60 text-[12px]">...</span>}
            </div>
          </div>

          <div className="text-text-muted/40 group-hover/activity:text-text-main shrink-0 transition-colors">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="animate-in fade-in slide-in-from-left-4 mt-3 ml-5 flex flex-col gap-4 rounded-md bg-surface-secondary/15 px-4 py-3 duration-300">
          {events.map((e) => {
            const isLastStreaming = isStreaming && e.id === events[events.length - 1].id;
            if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
              return (
                <div key={e.id} className="relative" role="region" aria-label="Agent thought step">
                  <div className={`absolute top-[18px] -left-[29px] h-2.5 w-2.5 rounded-full border transition-all duration-300 ${
                    isLastStreaming
                      ? 'bg-accent border-accent shadow-[0_0_4px_rgba(203,166,247,0.5)]'
                      : 'bg-surface-secondary border-border/80'
                  }`} />
                  <TextCard
                    content={e.data.content}
                    variant="thought"
                    isStreaming={isLastStreaming}
                  />
                </div>
              );
            }
            if (e.type === 'tool_call' || e.type === 'approval_request') {
              const reqData = e.data as { name?: string; request?: { toolCall?: { name?: string; arguments?: Record<string, unknown> } } };
              const toolName = reqData.request?.toolCall?.name ?? reqData.name ?? 'tool';
              const payload = (e.type === 'approval_request' ? (reqData.request?.toolCall ?? reqData) : e.data) as { name: string; arguments?: Record<string, unknown> };
              return (
                <div key={e.id} className="relative">
                  <div className={`absolute top-[20px] -left-[29px] h-2.5 w-2.5 rounded-full border transition-all duration-300 ${
                    isLastStreaming
                      ? 'bg-accent border-accent shadow-[0_0_4px_rgba(203,166,247,0.5)]'
                      : 'bg-surface-secondary border-border/80'
                  }`} />
                  <ToolCallCard
                    tool={toolName}
                    payload={payload}
                    isStreaming={isLastStreaming}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

