import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Activity, CheckCircle2, Clock } from 'lucide-react';
import { TextCard } from './TextCard';
import { ToolCallCard } from './ToolCallCard';
import type { ACPEventRow } from '@agentctl/shared';

const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
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
  return formatter(args);
}

interface ActivityGroupProps {
  events: ACPEventRow[];
  isStreaming?: boolean;
}

export function ActivityGroup({ events, isStreaming = false }: ActivityGroupProps) {
  const [isOpen, setIsOpen] = useState(isStreaming);

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  const { breadcrumbs, duration } = useMemo(() => {
    const steps: string[] = [];
    let hasThought = false;

    for (const e of events) {
      if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
        if (!hasThought) {
          steps.push('Thinking');
          hasThought = true;
        }
      } else if (e.type === 'tool_call') {
        const args = e.data.arguments ?? {};
        steps.push(getToolLabel(e.data.name, args));
      }
    }

    const start = events[0].createdAt;
    const end = events[events.length - 1].createdAt;
    const diff = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
    const duration = diff > 1000 ? `${(diff / 1000).toFixed(1)}s` : `${String(diff)}ms`;

    return { breadcrumbs: steps, duration };
  }, [events]);

  return (
    <div className="group/activity my-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
          className={`flex grow items-center gap-4 rounded-2xl border px-5 py-3 text-left shadow-2xl backdrop-blur-2xl transition-all duration-500 ${
            isOpen
              ? 'border-white/20 bg-white/10 ring-1 ring-white/10'
              : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
          }`}
        >
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-500 ${isStreaming ? 'bg-accent text-background shadow-[0_0_15px_rgba(203,166,247,0.4)]' : 'text-text-muted/60 border border-white/10 bg-white/10'}`}
          >
            {isStreaming ? (
              <Activity className="h-4 w-4 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`text-[11px] font-black tracking-[0.2em] uppercase ${isStreaming ? 'text-accent' : 'text-text-main'}`}
              >
                {isStreaming ? 'Agent_Processing' : 'Process_Complete'}
              </span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <div className="text-text-muted/40 flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase">
                <Clock className="h-3 w-3" />
                <span>{duration}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-hidden">
              {breadcrumbs.map((step, i) => (
                <div key={i} className="flex shrink-0 items-center gap-2">
                  <span
                    className={`max-w-[200px] truncate text-[12px] font-bold ${i === breadcrumbs.length - 1 && isStreaming ? 'text-text-main' : 'text-text-muted/60'}`}
                  >
                    {step}
                  </span>
                  {i < breadcrumbs.length - 1 && (
                    <ChevronRight className="text-text-muted/20 h-3 w-3" />
                  )}
                </div>
              ))}
              {isStreaming && <span className="text-accent animate-pulse text-[12px]">...</span>}
            </div>
          </div>

          <div className="text-text-muted/20 group-hover/activity:text-text-muted/60 shrink-0 transition-colors">
            {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="animate-in fade-in slide-in-from-left-4 mt-4 ml-6 space-y-6 border-l-2 border-white/10 py-2 pl-8 duration-500">
          {events.map((e) => {
            if (e.type === 'text' && 'role' in e.data && e.data.role === 'thought') {
              return (
                <div key={e.id} className="relative" role="region" aria-label="Agent thought step">
                  <div className="absolute top-6 -left-[35px] h-2.5 w-2.5 rounded-full border border-white/40 bg-white/20" />
                  <TextCard
                    content={e.data.content}
                    variant="thought"
                    isStreaming={isStreaming && e.id === events[events.length - 1].id}
                  />
                </div>
              );
            }
            if (e.type === 'tool_call') {
              return (
                <div key={e.id} className="relative">
                  <div className="bg-accent/40 border-accent/60 absolute top-6 -left-[35px] h-2.5 w-2.5 rounded-full border" />
                  <ToolCallCard
                    tool={e.data.name}
                    payload={e.data}
                    isStreaming={isStreaming && e.id === events[events.length - 1].id}
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
