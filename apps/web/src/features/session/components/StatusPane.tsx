import { useSession } from '../../../contexts/SessionContext';
import type { ReviewFile } from './ReviewView';
import { CheckSquare, Square, FileText } from 'lucide-react';

interface StatusPaneProps {
  files: ReviewFile[];
}

export function StatusPane({ files }: StatusPaneProps) {
  const { planItems } = useSession();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center justify-between border-b p-2">
        <h2 className="text-text-muted text-[10px] font-bold tracking-widest uppercase">
          Agent Status
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="bg-white h-1.5 w-1.5 animate-pulse" />
          <span className="text-white text-[9px] font-bold uppercase tracking-tight">Active</span>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-2">
        <section className="content-visibility-auto contain-intrinsic-size-[auto_120px]">
          <h3 className="text-white/40 mb-3 text-[9px] font-black tracking-[0.2em] uppercase">
            ::LIVE_PLAN
          </h3>
          <div className="space-y-2">
            {planItems.length > 0 ? (
              planItems.map((item) => (
                <div key={item.text} className="group flex gap-2">
                  {item.completed ? (
                    <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-100" />
                  ) : (
                    <Square className="text-text-muted group-hover:text-white mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors" />
                  )}
                  <span
                    className={`text-[11px] leading-tight font-bold tracking-tight uppercase ${item.completed ? 'text-text-muted line-through opacity-40' : 'text-white'}`}
                  >
                    {item.text}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted text-[10px] italic uppercase opacity-30 tracking-tight">Empty plan.</p>
            )}
          </div>
        </section>

        <section className="content-visibility-auto contain-intrinsic-size-[auto_200px]">
          <h3 className="text-white/40 mb-3 text-[9px] font-black tracking-[0.2em] uppercase">
            ::AFFECTED_FILES
          </h3>
          <div className="space-y-1.5">
            {files.length > 0 ? (
              files.map((file, i) => (
                <div
                  key={i}
                  className="bg-white/[0.02] border-white/5 flex items-center gap-2 rounded-sm border px-2 py-1.5 transition-all hover:bg-white/5"
                >
                  <FileText className="text-text-muted h-3.5 w-3.5" />
                  <span className="text-white truncate text-[11px] font-bold uppercase tracking-tighter" title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-text-muted text-[10px] italic uppercase opacity-30 tracking-tight">No modifications.</p>
            )}
          </div>
        </section>
      </div>


    </div>
  );
}

