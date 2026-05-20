import { useSession } from '../../../contexts/SessionContext';
import type { ReviewFile } from './ReviewView';
import { CheckCircle2, Circle, FileText } from 'lucide-react';

interface StatusPaneProps {
  files: ReviewFile[];
}

export function StatusPane({ files }: StatusPaneProps) {
  const { planItems } = useSession();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="text-text-muted text-[11px] font-bold tracking-[0.1em] uppercase">
          Agent Status
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="bg-success h-2 w-2 animate-pulse rounded-full" />
          <span className="text-success text-[10px] font-medium uppercase">Active</span>
        </div>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto p-4">
        <section>
          <h3 className="text-text-muted/60 mb-4 text-[10px] font-black tracking-widest uppercase">
            Live Plan
          </h3>
          <div className="space-y-3">
            {planItems.length > 0 ? (
              planItems.map((item) => (
                <div key={item.text} className="group flex gap-3">
                  {item.completed ? (
                    <CheckCircle2 className="text-success mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <Circle className="text-text-muted group-hover:text-accent mt-0.5 h-4 w-4 shrink-0 transition-colors" />
                  )}
                  <span
                    className={`text-[13px] leading-tight ${item.completed ? 'text-text-muted line-through' : 'text-text-main'}`}
                  >
                    {item.text}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted text-[12px] italic">No active plan detected.</p>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-text-muted/60 mb-4 text-[10px] font-black tracking-widest uppercase">
            Affected Files
          </h3>
          <div className="space-y-2">
            {files.length > 0 ? (
              files.map((file, i) => (
                <div
                  key={i}
                  className="bg-surface/30 hover:border-border flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-all"
                >
                  <FileText className="text-text-muted h-3.5 w-3.5" />
                  <span className="text-text-main truncate font-mono text-[12px]" title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted text-[12px] italic">No files modified.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
