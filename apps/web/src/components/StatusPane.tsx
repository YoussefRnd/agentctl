import { useMemo } from 'react';
import type { ACPEventRow } from '@agentctl/shared';
import type { ReviewFile } from './ReviewView';
import { CheckCircle2, Circle, FileText } from 'lucide-react';

interface StatusPaneProps {
  events: ACPEventRow[];
  files: ReviewFile[];
}

export function StatusPane({ events, files }: StatusPaneProps) {
  // Parse plan items from events, deduplicating by text and keeping the latest state
  const planItems = useMemo(() => {
    const planMap = new Map<string, boolean>();
    
    events
      .filter(e => e.type === 'text')
      .forEach(e => {
        const content = (e.data as { content: string }).content;
        if (!content) return;
        
        const lines = content.split('\n');
        lines.forEach(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]')) {
            const text = trimmed.replace(/- \[[ x]\]/, '').trim();
            const completed = trimmed.includes('[x]');
            planMap.set(text, completed);
          }
        });
      });

    return Array.from(planMap.entries()).map(([text, completed]) => ({
      text,
      completed,
    }));
  }, [events]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">Agent Status</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-[10px] font-medium text-success uppercase">Active</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-8">
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-text-muted/60 mb-4">Live Plan</h3>
          <div className="space-y-3">
            {planItems.length > 0 ? (
              planItems.map((item) => (
                <div key={item.text} className="flex gap-3 group">
                  {item.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-text-muted shrink-0 mt-0.5 group-hover:text-accent transition-colors" />
                  )}
                  <span className={`text-[13px] leading-tight ${item.completed ? 'text-text-muted line-through' : 'text-text-main'}`}>
                    {item.text}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-text-muted italic">No active plan detected.</p>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-text-muted/60 mb-4">Affected Files</h3>
          <div className="space-y-2">
            {files.length > 0 ? (
              files.map((file, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/30 border border-transparent hover:border-border transition-all">
                  <FileText className="w-3.5 h-3.5 text-text-muted" />
                  <span className="text-[12px] font-mono text-text-main truncate" title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-text-muted italic">No files modified.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
