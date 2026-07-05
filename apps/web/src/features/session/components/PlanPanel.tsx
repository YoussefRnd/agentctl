import { useMemo } from 'react';
import { Circle, Loader2, CheckCircle2 } from 'lucide-react';
import {
  useSessionStream,
  useSession,
  type StructuredPlanItem,
} from '../../../contexts/SessionContext';

export function PlanPanel() {
  const { structuredPlan } = useSessionStream();
  const { sessionData } = useSession();

  const sessionPlan = sessionData?.session.plan;

  const plan = useMemo(() => {
    return structuredPlan.length > 0 ? structuredPlan : (sessionPlan ?? []);
  }, [structuredPlan, sessionPlan]);

  return (
    <section className="content-visibility-auto contain-intrinsic-size-[auto_120px]">
      <h3 className="text-text-muted/30 mb-5 text-[10px] font-black tracking-[0.3em] uppercase">
        Plan
      </h3>
      <div className="space-y-3">
        {plan.length > 0 ? (
          plan.map((item: StructuredPlanItem, index: number) => {
            const isCompleted = item.status === 'completed' || item.isCompleted;
            const isInProgress = item.status === 'in_progress';

            return (
              <div
                key={`${item.name}-${String(index)}`}
                className={`group flex items-start gap-3.5 rounded-lg border px-3 py-2.5 transition-all duration-300 ${
                  isInProgress
                    ? 'bg-surface-accent border-accent/20 ring-accent/10 ring-1'
                    : isCompleted
                      ? 'bg-surface-secondary/10 border-border/5 opacity-60'
                      : 'hover:bg-surface-secondary/20 hover:border-border/10 border-transparent bg-transparent'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {isCompleted ? (
                    <div className="bg-success/10 text-success ring-success/20 flex h-5 w-5 items-center justify-center rounded-full ring-1">
                      <CheckCircle2 className="h-3 w-3" />
                    </div>
                  ) : isInProgress ? (
                    <div className="bg-accent/20 text-accent ring-accent/30 flex h-5 w-5 items-center justify-center rounded-full shadow-[0_0_10px_rgba(203,166,247,0.2)] ring-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </div>
                  ) : (
                    <div className="bg-surface-tertiary/30 text-text-muted/20 ring-border/10 group-hover:text-text-muted/50 group-hover:ring-border/20 flex h-5 w-5 items-center justify-center rounded-full ring-1 transition-all">
                      <Circle className="h-2.5 w-2.5" />
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={`text-[11px] leading-relaxed font-bold tracking-tight uppercase transition-all ${
                      isCompleted
                        ? 'text-text-muted/40 decoration-text-muted/20 line-through'
                        : isInProgress
                          ? 'text-accent'
                          : 'text-text-main group-hover:text-accent/70'
                    }`}
                  >
                    {item.name}
                  </span>
                  {isInProgress && (
                    <div className="flex items-center gap-1.5">
                      <span className="bg-accent flex h-1 w-1 animate-ping rounded-full" />
                      <span className="text-accent/80 text-[8px] font-black tracking-[0.2em] uppercase">
                        Executing_Task...
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-6 opacity-20">
            <p className="text-[9px] font-bold tracking-widest uppercase italic">
              Plan_Not_Initialized
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
