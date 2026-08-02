import { useMemo } from 'react';
import { Circle, Loader2, CheckCircle2 } from 'lucide-react';
import {
  useSessionStream,
  useSession,
  type StructuredPlanItem,
} from '../../../contexts/SessionContext';

export interface PlanPanelProps {
  plan?: StructuredPlanItem[];
}

export function PlanPanel({ plan: customPlan }: PlanPanelProps = {}) {
  const { structuredPlan } = useSessionStream();
  const { sessionData } = useSession();

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
      {plan.map((item: StructuredPlanItem, index: number) => {
        const isCompleted = item.status === 'completed' || item.isCompleted;
        const isInProgress = item.status === 'in_progress';

        return (
          <div
            key={`${item.name}-${String(index)}`}
            className={`group flex items-start gap-3 rounded-lg border p-3 transition-all duration-200 ${
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
              ) : (
                <div className="bg-surface-tertiary/40 text-text-muted/60 ring-border/20 group-hover:text-text-muted flex h-5 w-5 items-center justify-center rounded-full ring-1">
                  <Circle className="h-3 w-3" />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={`text-xs leading-relaxed font-medium transition-colors ${
                  isCompleted
                    ? 'text-text-muted line-through'
                    : isInProgress
                      ? 'text-accent font-semibold'
                      : 'text-text-main group-hover:text-accent/90'
                }`}
              >
                {item.name}
              </span>
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
