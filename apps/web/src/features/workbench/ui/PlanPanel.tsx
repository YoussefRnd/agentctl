import { useMemo } from 'react';
import { Circle, Loader2, CheckCircle2 } from 'lucide-react';
import { useSessionStream, useSession, type StructuredPlanItem } from '@/features/sessions';

export interface PlanPanelProps {
  plan?: StructuredPlanItem[];
}

export function PlanPanel({ plan: customPlan }: PlanPanelProps = {}) {
  const { structuredPlan } = useSessionStream();
  const { sessionData } = useSession();

  const sessionStatus = sessionData?.session.status;
  const isSessionRunning = sessionStatus === 'running' || sessionStatus === 'needs_attention';
  const sessionPlan = sessionData?.session.plan;

  const plan = useMemo(() => {
    if (customPlan) return customPlan;
    return structuredPlan.length > 0 ? structuredPlan : (sessionPlan ?? []);
  }, [customPlan, structuredPlan, sessionPlan]);

  if (plan.length === 0) {
    return (
      <div className="border-border/20 flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center">
        <p className="text-text-muted text-xs font-normal">No plan execution steps active</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {plan.map((item: StructuredPlanItem) => {
        const isCompleted = item.status === 'completed' || item.isCompleted;
        const isInProgress = item.status === 'in_progress' && isSessionRunning;
        const isPaused = item.status === 'in_progress' && !isSessionRunning;

        return (
          <div
            key={item.name}
            className={`group flex items-start gap-3 rounded-lg border p-3 transition-colors duration-200 ${
              isInProgress
                ? 'bg-surface-accent/20 border-accent/30 ring-accent/20 ring-1'
                : isCompleted
                  ? 'bg-surface-secondary/20 border-border/10'
                  : 'bg-surface-secondary/10 border-border/10 hover:bg-surface-secondary/30 hover:border-border/20'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {isCompleted ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              ) : isInProgress ? (
                <div className="bg-accent/20 text-accent ring-accent/30 flex h-5 w-5 items-center justify-center rounded-full ring-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                </div>
              ) : isPaused ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
                  <Circle className="h-3 w-3 fill-amber-400/40" />
                </div>
              ) : (
                <div className="bg-surface-tertiary/40 text-text-muted/60 ring-border/20 group-hover:text-text-muted flex h-5 w-5 items-center justify-center rounded-full ring-1">
                  <Circle className="h-3 w-3" />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`text-xs leading-relaxed font-medium transition-colors ${
                    isCompleted
                      ? 'text-text-muted line-through'
                      : isInProgress
                        ? 'text-accent font-semibold'
                        : isPaused
                          ? 'text-text-main/90 font-medium'
                          : 'text-text-main group-hover:text-accent/90'
                  }`}
                >
                  {item.name}
                </span>
                {item.priority && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${
                      item.priority === 'high'
                        ? 'bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20'
                        : item.priority === 'medium'
                          ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
                          : 'bg-surface-tertiary/50 text-text-muted ring-border/20 ring-1'
                    }`}
                  >
                    {item.priority}
                  </span>
                )}
              </div>
              {isInProgress && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
                  <span className="text-accent/90 text-xs font-medium">Executing task...</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
