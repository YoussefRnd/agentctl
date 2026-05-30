import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Activity, CheckCircle2, Clock } from 'lucide-react';
import { TextCard } from './TextCard';
import { ToolCallCard } from './ToolCallCard';
import type { ACPEventRow } from '@agentctl/shared';

const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  read_file: (args) => `Reading ${typeof args.path === 'string' ? args.path.split('/').pop() ?? 'file' : 'file'}`,
  write_file: (args) => `Writing ${typeof args.path === 'string' ? args.path.split('/').pop() ?? 'file' : 'file'}`,
  grep_search: (args) => `Searching for "${typeof args.pattern === 'string' ? args.pattern : ''}"`,
  run_shell_command: (args) => `Executing ${typeof args.command === 'string' ? args.command.split(' ')[0] ?? 'command' : 'command'}`,
  list_directory: (args) => `Listing ${typeof args.dir_path === 'string' ? args.dir_path : 'directory'}`,
  web_search: (args) => `Searching web for "${typeof args.query === 'string' ? args.query : ''}"`,
  web_fetch: (args) => `Fetching ${typeof args.url === 'string' ? args.url.split('/').pop() ?? 'webpage' : 'webpage'}`,
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
      if (
        e.type === 'text' &&
        'role' in e.data &&
        e.data.role === 'thought'
      ) {
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
          onClick={() => { setIsOpen(!isOpen); }}
          className={`flex items-center gap-4 px-5 py-3 rounded-2xl border transition-all duration-500 text-left grow backdrop-blur-2xl shadow-2xl ${
            isOpen 
               ? 'bg-white/10 border-white/20 ring-1 ring-white/10' 
               : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
          }`}
        >
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-500 ${isStreaming ? 'bg-accent text-background shadow-[0_0_15px_rgba(203,166,247,0.4)]' : 'bg-white/10 text-text-muted/60 border border-white/10'}`}>
            {isStreaming ? (
              <Activity className="h-4 w-4 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[11px] font-black uppercase tracking-[0.2em] ${isStreaming ? 'text-accent' : 'text-text-main'}`}>
                {isStreaming ? 'Agent_Processing' : 'Process_Complete'}
              </span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <div className="flex items-center gap-1.5 text-text-muted/40 text-[10px] font-bold uppercase tracking-widest">
                <Clock className="h-3 w-3" />
                <span>{duration}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 overflow-hidden">
              {breadcrumbs.map((step, i) => (
                <div key={i} className="flex items-center gap-2 shrink-0">
                  <span className={`text-[12px] font-bold truncate max-w-[200px] ${i === breadcrumbs.length - 1 && isStreaming ? 'text-text-main' : 'text-text-muted/60'}`}>
                    {step}
                  </span>
                  {i < breadcrumbs.length - 1 && (
                    <ChevronRight className="h-3 w-3 text-text-muted/20" />
                  )}
                </div>
              ))}
              {isStreaming && <span className="text-[12px] text-accent animate-pulse">...</span>}
            </div>
          </div>

          <div className="shrink-0 text-text-muted/20 group-hover/activity:text-text-muted/60 transition-colors">
            {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </div>
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 ml-6 pl-8 border-l-2 border-white/10 space-y-6 py-2 animate-in fade-in slide-in-from-left-4 duration-500">
          {events.map((e) => {
            if (
              e.type === 'text' &&
              'role' in e.data &&
              e.data.role === 'thought'
            ) {
              return (
                <div key={e.id} className="relative" role="region" aria-label="Agent thought step">
                  <div className="absolute -left-[35px] top-6 h-2.5 w-2.5 rounded-full bg-white/20 border border-white/40" />
                  <TextCard content={e.data.content} variant="thought" isStreaming={isStreaming && e.id === events[events.length - 1].id} />
                </div>
              );
            }
            if (e.type === 'tool_call') {
              return (
                <div key={e.id} className="relative">
                   <div className="absolute -left-[35px] top-6 h-2.5 w-2.5 rounded-full bg-accent/40 border border-accent/60" />
                   <ToolCallCard tool={e.data.name} payload={e.data} />
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
