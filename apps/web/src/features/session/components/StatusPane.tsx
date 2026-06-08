import { useSessionStream } from '../../../contexts/SessionContext';
import type { ReviewFile } from './ReviewView';
import { CheckSquare, Square, FileText } from 'lucide-react';


interface StatusPaneProps {
  files: ReviewFile[];
}

export function StatusPane({ files }: StatusPaneProps) {
  const { planItems } = useSessionStream();


  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="custom-scrollbar flex-1 space-y-8 overflow-y-auto p-4">
        <section className="content-visibility-auto contain-intrinsic-size-[auto_120px]">
          <h3 className="text-text-muted/30 mb-4 text-[9px] font-black tracking-[0.25em] uppercase">
            ::LIVE_PLAN
          </h3>
          <div className="space-y-2.5">
            {planItems.length > 0 ? (
              planItems.map((item) => (
                <div key={item.text} className="group flex items-start gap-2.5">
                  {item.completed ? (
                    <CheckSquare className="text-success mt-0.5 h-3.5 w-3.5 shrink-0 opacity-100" />
                  ) : (
                    <Square className="text-text-muted/40 group-hover:text-accent mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors" />
                  )}
                  <span
                    className={`text-[11px] leading-snug font-bold tracking-tight uppercase ${item.completed ? 'text-text-muted line-through opacity-30' : 'text-text-main'}`}
                  >
                    {item.text}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted pl-1 text-[10px] tracking-widest uppercase italic opacity-20">
                Empty_Plan
              </p>
            )}
          </div>
        </section>

        <section className="content-visibility-auto contain-intrinsic-size-[auto_200px]">
          <h3 className="text-text-muted/30 mb-4 text-[9px] font-black tracking-[0.25em] uppercase">
            ::AFFECTED_FILES
          </h3>
          <div className="grid gap-1">
            {files.length > 0 ? (
              files.map((file, i) => (
                <div
                  key={i}
                  className="bg-surface-secondary/20 border-border/40 hover:bg-surface-tertiary/40 group flex cursor-pointer items-center gap-2.5 rounded border px-2.5 py-2 transition-all"
                >
                  <FileText className="text-text-muted group-hover:text-text-main h-3.5 w-3.5 transition-colors" />
                  <span
                    className="text-text-main truncate text-[11px] font-bold tracking-tighter uppercase"
                    title={file.path}
                  >
                    {file.path.split('/').pop()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted pl-1 text-[10px] tracking-widest uppercase italic opacity-20">
                No_Modifications
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
