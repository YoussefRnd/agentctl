import { Spinner } from '@agentctl/ui';
import { StreamingMarkdown } from '@/shared/markdown';
import { latestPlanArtifacts } from '../libPlanArtifacts';
import { useMemo } from 'react';
import { Circle, CheckCircle2, CircleSlash } from 'lucide-react';
import { useSessionStream, useSession, type StructuredPlanItem } from '@/features/sessions';

export interface PlanPanelProps {
  plan?: StructuredPlanItem[];
}

export function PlanPanel({ plan: customPlan }: PlanPanelProps = {}) {
  const { structuredPlan, events } = useSessionStream();
  const { sessionData } = useSession();

  const artifacts = latestPlanArtifacts(events, sessionData?.session.planArtifacts);
  const richPlans = artifacts.filter((artifact) => artifact.kind !== 'items');
  const sessionStatus = sessionData?.session.status;
  const isSessionRunning = sessionStatus === 'running' || sessionStatus === 'needs_attention';
  const sessionPlan = sessionData?.session.plan;

  const plan = useMemo(() => {
    const latest = events.findLast((event) => event.type === 'plan_update');
    if (latest?.type === 'plan_update') return latest.data.plan as StructuredPlanItem[];
    if (customPlan) return customPlan;
    return structuredPlan.length > 0 ? structuredPlan : (sessionPlan ?? []);
  }, [customPlan, structuredPlan, sessionPlan, events]);

  if (plan.length === 0 && richPlans.length === 0) {
    return (
      <div className="border-border/20 flex min-h-20 items-center justify-center rounded-lg border border-dashed px-4 text-center">
        <p className="text-text-muted text-xs font-normal">No plan execution steps active</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {richPlans.map((artifact) => (
        <div key={artifact.id} className="border-border/30 rounded-lg border p-3 text-xs">
          {artifact.kind === 'markdown' ? (
            <div className="prose max-w-none">
              <StreamingMarkdown content={artifact.markdown ?? ''} isStreaming={false} />
            </div>
          ) : artifact.kind === 'file' ? (
            <p>
              Plan file: <span className="font-mono break-all">{artifact.uri}</span>
            </p>
          ) : (
            <p>Agent plan ({artifact.contentType ?? 'unknown format'})</p>
          )}
        </div>
      ))}
      {plan.map((item: StructuredPlanItem) => {
        const isCancelled = item.status === 'cancelled';
        const isUnknown = !['pending', 'in_progress', 'completed', 'cancelled'].includes(
          item.status,
        );
        const isCompleted = !isCancelled && (item.status === 'completed' || item.isCompleted);
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
              {isCancelled ? (
                <div className="text-text-muted flex h-5 w-5 items-center justify-center">
                  <CircleSlash aria-hidden className="h-3.5 w-3.5" />
                </div>
              ) : isCompleted ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              ) : isInProgress ? (
                <div className="bg-accent/20 text-accent ring-accent/30 flex h-5 w-5 items-center justify-center rounded-full ring-1">
                  <Spinner aria-hidden="true" className="icon-compact" />
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
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <span
                  className={`min-w-0 flex-1 text-xs leading-relaxed font-medium [overflow-wrap:anywhere] transition-colors ${
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
              {(isCancelled || isUnknown) && (
                <p className="text-text-muted text-xs">
                  {isCancelled ? 'Cancelled' : `Status: ${item.status}`}
                </p>
              )}
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
