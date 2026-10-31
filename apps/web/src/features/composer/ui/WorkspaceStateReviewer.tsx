import { useState, type ReactNode } from 'react';
import { Monitor } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { GitBranchIcon, RepoPullIcon, RepoPushIcon } from '@primer/octicons-react';
import { toast } from 'sonner';
import { useSessionWorkspace } from '@/features/sessions';
import { useGitStatus } from '@/shared/workspace/useGitStatus';
import type { SessionWithCapabilities, ReportedCost } from '@agentctl/shared';
import { CommandDropdown } from './CommandDropdown';
import { formatTokenCount } from '@/shared/lib/formatTokenCount';

function formatBranchName(branch: string) {
  if (branch === 'HEAD') return 'Detached HEAD';
  if (branch.startsWith('agentctl/')) {
    const parts = branch.split('/');
    if (parts.length >= 3) {
      return parts.slice(2).join('/');
    }
    if (parts.length === 2) {
      return parts[1].slice(0, 8);
    }
  }
  return branch;
}

function formatReportedCost(cost: ReportedCost | null | undefined): string {
  if (!cost) return 'Unavailable';
  const amount =
    cost.amount > 0 && cost.amount < 0.01
      ? cost.amount.toPrecision(3)
      : cost.amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        });
  return `${cost.currency} ${amount}`;
}

export function ContextWindowPopover({
  sessionData,
  isLoading,
}: {
  sessionData: SessionWithCapabilities | null;
  isLoading: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (isLoading || !sessionData?.session) return null;

  const { contextUsedTokens, contextLimit, sessionMetrics } = sessionData.session;
  const safeTokens =
    typeof contextUsedTokens === 'number' &&
    Number.isFinite(contextUsedTokens) &&
    contextUsedTokens >= 0
      ? contextUsedTokens
      : null;

  // Use the agent-calculated context limit without guessing hardcoded fallbacks
  const calculatedLimit =
    typeof contextLimit === 'number' && contextLimit > 0 ? contextLimit : null;

  const hasCalculatedLimit = calculatedLimit !== null;
  const usagePercent =
    hasCalculatedLimit && safeTokens !== null
      ? Math.min(100, Math.max(0, (safeTokens / calculatedLimit) * 100))
      : null;
  const { reportedCost, lastTurn } = sessionMetrics;
  const consumption = (
    [
      ['Total', lastTurn?.totalTokens],
      ['Input', lastTurn?.inputTokens],
      ['Output', lastTurn?.outputTokens],
      ['Cache read', lastTurn?.cachedReadTokens],
      ['Cache write', lastTurn?.cachedWriteTokens],
      ['Reasoning', lastTurn?.thoughtTokens],
    ] as const
  ).flatMap(([label, count]) => (count !== undefined ? [{ label, count }] : []));
  const usageBreakdown = safeTokens !== null ? sessionMetrics.usageBreakdown : undefined;
  const turnsRemaining = safeTokens !== null ? sessionMetrics.turnsRemaining : undefined;

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    usagePercent !== null ? circumference - (usagePercent / 100) * circumference : circumference;

  return (
    <div
      onMouseEnter={() => {
        setIsOpen(true);
      }}
      onMouseLeave={() => {
        setIsOpen(false);
      }}
      className="relative flex items-center"
    >
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={safeTokens === null ? 'Context usage unavailable' : 'Context usage'}
            onClick={() => {
              setIsOpen((prev) => !prev);
            }}
            className={cn(
              'group border-border/10 text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 flex h-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border text-[10px] font-bold tracking-wider transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none',
              'w-8 gap-0 px-0',
              isOpen && 'bg-accent/10 text-accent border-accent/40 w-16 gap-1.5 px-3',
            )}
          >
            <svg className="h-5 w-5 shrink-0 -rotate-90" viewBox="0 0 20 20">
              <circle
                cx="10"
                cy="10"
                r={radius}
                className="stroke-text-muted/10 fill-none"
                strokeWidth="3"
              />
              <circle
                cx="10"
                cy="10"
                r={radius}
                className={cn(
                  'fill-none transition-colors duration-300',
                  usagePercent === null
                    ? 'stroke-text-muted/30'
                    : usagePercent > 90
                      ? 'stroke-danger'
                      : usagePercent > 70
                        ? 'stroke-warning'
                        : 'stroke-accent',
                )}
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <span
              className={cn(
                'shrink-0 transition-colors duration-300',
                isOpen ? 'w-auto overflow-visible opacity-100' : 'w-0 overflow-hidden opacity-0',
              )}
            >
              {usagePercent !== null
                ? `${Math.round(usagePercent)}%`
                : safeTokens !== null
                  ? formatTokenCount(safeTokens)
                  : '—'}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-[320px] rounded-lg p-4 shadow-2xl">
          <div className="flex flex-col gap-3 font-sans text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted/45 text-[9px] font-bold tracking-[0.2em] uppercase">
                Context window
              </span>
              <div className="text-text-muted mt-0.5 flex items-baseline justify-between text-[11px] font-semibold">
                <span className="font-mono">
                  {safeTokens === null
                    ? 'Unavailable'
                    : hasCalculatedLimit
                      ? `${formatTokenCount(safeTokens)} / ${formatTokenCount(calculatedLimit)} tokens`
                      : `${formatTokenCount(safeTokens)} tokens`}
                </span>
                <span
                  className={cn(
                    'font-mono font-bold',
                    usagePercent === null
                      ? 'text-text-muted'
                      : usagePercent > 90
                        ? 'text-danger'
                        : usagePercent > 70
                          ? 'text-warning'
                          : 'text-accent',
                  )}
                >
                  {usagePercent !== null ? `${usagePercent.toFixed(1)}%` : '—'}
                </span>
              </div>
              {safeTokens === null && (
                <p className="text-text-muted text-[11px]">
                  The provider has not reported current context usage.
                </p>
              )}
              {safeTokens !== null && !hasCalculatedLimit && (
                <p className="text-text-muted text-[11px]">Context capacity unavailable.</p>
              )}
            </div>

            <div className="bg-surface-tertiary/30 ring-border/10 relative h-2 w-full overflow-hidden rounded-full ring-1">
              {hasCalculatedLimit && usageBreakdown ? (
                <div className="absolute inset-0 flex h-full w-full">
                  <div
                    className="bg-accent/80 h-full"
                    style={{
                      width: `${String(((usageBreakdown.history ?? 0) / calculatedLimit) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-brand-teal/70 h-full"
                    style={{
                      width: `${String(((usageBreakdown.files ?? 0) / calculatedLimit) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-brand-lavender/40 h-full"
                    style={{
                      width: `${String(((usageBreakdown.system ?? 0) / calculatedLimit) * 100)}%`,
                    }}
                  />
                </div>
              ) : hasCalculatedLimit && usagePercent !== null ? (
                <div
                  className="bg-accent absolute top-0 left-0 h-full rounded-full transition-colors duration-300"
                  style={{ width: `${String(usagePercent)}%` }}
                />
              ) : null}
            </div>

            {consumption.length > 0 && (
              <div className="border-border/10 space-y-1 border-t pt-2">
                <p className="text-text-muted/60 text-[9px] font-bold tracking-wider uppercase">
                  Last turn consumption
                </p>
                <dl className="grid grid-cols-2 gap-1 font-mono">
                  {consumption.map(({ label, count }) => (
                    <div key={label}>
                      <dt className="text-text-muted">{label}</dt>
                      <dd>{formatTokenCount(count)} tokens</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-text-muted text-[11px]">
                  Provider-reported tokens processed during the last turn, separate from current
                  context occupancy.
                </p>
              </div>
            )}

            <div className="border-border/10 space-y-1 border-t pt-2">
              <p className="text-text-muted/60 text-[9px] font-bold tracking-wider uppercase">
                Provider reported cost
              </p>
              <dl className="grid grid-cols-2 gap-1 font-mono">
                <div>
                  <dt className="text-text-muted">Session</dt>
                  <dd>{formatReportedCost(reportedCost)}</dd>
                </div>
                {lastTurn?.cost && (
                  <div>
                    <dt className="text-text-muted">Last turn</dt>
                    <dd>{formatReportedCost(lastTurn.cost)}</dd>
                  </div>
                )}
              </dl>
              <p className="text-text-muted text-[11px]">
                Session and last-turn amounts are reported separately by the agent.
              </p>
            </div>

            {(usageBreakdown !== undefined || turnsRemaining !== undefined) && (
              <div className="border-border/10 mt-1 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-2">
                {usageBreakdown?.history !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      History
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      {formatTokenCount(usageBreakdown.history)}
                    </span>
                  </div>
                )}
                {usageBreakdown?.files !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      Knowledge
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      {formatTokenCount(usageBreakdown.files)}
                    </span>
                  </div>
                )}
                {turnsRemaining !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      Turns left
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      ~{turnsRemaining}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function CommandBarFooter({
  isLoadingSession,
  sessionData,
  isSwitchingMode,
  switchMode,
  isSwitchingBranch,
  switchBranch,
  branches,
  approvalControl,
}: {
  isLoadingSession: boolean;
  sessionData: SessionWithCapabilities | null;
  isSwitchingMode: boolean;
  switchMode: (mode: 'local' | 'worktree') => Promise<void>;
  isSwitchingBranch: boolean;
  switchBranch: (branch: string) => Promise<void>;
  branches: string[];
  approvalControl: ReactNode;
}) {
  const { pushChanges, pullChanges, isPushing, isPulling, reviewData } = useSessionWorkspace();
  const { gitStatus } = useGitStatus(sessionData?.session.id ?? '');
  const currentBranch = gitStatus.branch ?? sessionData?.session.branch ?? '';
  const hasUncommittedChanges = reviewData.files.some((file) => file.state !== 'committed');
  const canUseRemote =
    gitStatus.isRepo &&
    gitStatus.hasPrimaryRemote &&
    gitStatus.branch !== null &&
    gitStatus.branch !== 'HEAD';

  if (!isLoadingSession && !sessionData?.session) return null;

  return (
    <div className="text-text-muted/80 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 text-[11px] font-medium">
      {isLoadingSession ? (
        <div className="text-text-muted/60 flex items-center gap-1.5 py-1">
          <Monitor className="h-3.5 w-3.5" />
          <span>...</span>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <CommandDropdown
            value={sessionData?.session.mode ?? 'local'}
            disabled={isSwitchingMode}
            onChange={(val) => {
              void switchMode(val as 'local' | 'worktree');
            }}
            icon={<Monitor className="h-3.5 w-3.5" />}
            options={[
              { value: 'local', label: 'Local' },
              ...(sessionData?.session.project?.repoRoot
                ? [{ value: 'worktree', label: 'Worktree' }]
                : []),
            ]}
          />
          {approvalControl}
        </div>
      )}

      {isLoadingSession ? (
        <div className="text-text-muted/60 flex items-center gap-1.5 py-1">
          <GitBranchIcon className="h-3.5 w-3.5" />
          <span>...</span>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          {sessionData?.session.project?.repoRoot && (
            <div className="flex items-center gap-1.5">
              {gitStatus.hasUpstream && (gitStatus.aheadCount > 0 || gitStatus.behindCount > 0) && (
                <span className="text-text-muted/75 flex items-center gap-1 font-mono text-[10px] font-semibold">
                  {gitStatus.aheadCount > 0 && (
                    <span title={`${gitStatus.aheadCount} commit(s) ahead of upstream`}>
                      ↑{gitStatus.aheadCount}
                    </span>
                  )}
                  {gitStatus.behindCount > 0 && (
                    <span title={`${gitStatus.behindCount} commit(s) behind upstream`}>
                      ↓{gitStatus.behindCount}
                    </span>
                  )}
                </span>
              )}
              <div className="border-border/10 bg-surface-tertiary/10 flex shrink-0 items-center overflow-hidden rounded-md border">
                <button
                  type="button"
                  disabled={isPulling || !canUseRemote || hasUncommittedChanges}
                  onClick={() => {
                    void toast.promise(
                      pullChanges().then((res) => {
                        if (!res.success) throw new Error(res.output);
                        return res;
                      }),
                      {
                        loading: 'Pulling remote...',
                        success: 'Pulled successfully',
                        error: (err: unknown) =>
                          `Pull failed: ${err instanceof Error ? err.message : String(err)}`,
                      },
                    );
                  }}
                  className="text-text-muted/55 hover:text-accent hover:bg-surface-tertiary/20 border-border/10 flex h-6 w-6 cursor-pointer items-center justify-center border-r transition-all duration-150 active:scale-[0.95] disabled:pointer-events-none disabled:opacity-30"
                  title={
                    !canUseRemote
                      ? 'Configure a remote and check out a branch before pulling'
                      : hasUncommittedChanges
                        ? 'Commit or discard changes before pulling'
                        : 'Pull from remote'
                  }
                >
                  <RepoPullIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={isPushing || !canUseRemote}
                  onClick={() => {
                    void toast.promise(
                      pushChanges().then((res) => {
                        if (!res.success) throw new Error(res.output);
                        return res;
                      }),
                      {
                        loading: 'Pushing remote...',
                        success: 'Pushed successfully',
                        error: (err: unknown) =>
                          `Push failed: ${err instanceof Error ? err.message : String(err)}`,
                      },
                    );
                  }}
                  className="text-text-muted/55 hover:text-accent hover:bg-surface-tertiary/20 flex h-6 w-6 cursor-pointer items-center justify-center transition-all duration-150 active:scale-[0.95] disabled:pointer-events-none disabled:opacity-30"
                  title={
                    canUseRemote
                      ? `Push to ${gitStatus.remoteName ?? 'remote'}`
                      : 'Configure a remote and check out a branch before pushing'
                  }
                >
                  <RepoPushIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          <CommandDropdown
            value={currentBranch}
            disabled={isSwitchingBranch}
            onChange={(val) => {
              void switchBranch(val);
            }}
            icon={<GitBranchIcon className="h-3.5 w-3.5" />}
            align="end"
            options={[
              ...branches.map((b) => ({
                value: b,
                label: formatBranchName(b),
              })),
              ...(currentBranch && !branches.includes(currentBranch)
                ? [
                    {
                      value: currentBranch,
                      label: formatBranchName(currentBranch),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}
