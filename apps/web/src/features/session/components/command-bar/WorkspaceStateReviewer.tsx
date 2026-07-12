import { useState } from 'react';
import { Monitor, GitBranch, ArrowDown, ArrowUp } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { toast } from 'sonner';
import { useSession } from '../../../../contexts/SessionContext';
import type { SessionWithCapabilities } from '@agentctl/shared';
import { CommandDropdown } from './CommandDropdown';

function formatBranchName(branch: string) {
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

function formatTokens(tokens: number) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function ContextWindowPopover({
  sessionData,
  isLoading,
}: {
  sessionData: SessionWithCapabilities | null;
  isLoading: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);

  if (isLoading || !sessionData?.session) return null;

  const { totalTokens, contextLimit, sessionMetrics } = sessionData.session;
  if (!contextLimit || contextLimit <= 0) return null;

  const usagePercent = Math.min(100, Math.max(0, (totalTokens / contextLimit) * 100));
  const { usageBreakdown, estimatedCost, turnsRemaining } = sessionMetrics;

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (usagePercent / 100) * circumference;

  return (
    <div
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      className="relative flex items-center"
    >
      <Popover open={isHovered}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'group border-border/10 text-text-muted hover:text-text-main hover:bg-text-main/5 focus-visible:ring-accent/50 flex h-8 items-center justify-center overflow-hidden rounded-full border text-[10px] font-bold tracking-wider transition-all duration-300 focus-visible:ring-2 focus-visible:outline-none',
              'w-8 gap-0 px-0',
              'data-[state=open]:bg-accent/10 data-[state=open]:text-accent data-[state=open]:border-accent/40 data-[state=open]:w-16 data-[state=open]:gap-1.5 data-[state=open]:px-3',
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
                  'fill-none transition-all duration-300',
                  usagePercent > 90
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
                'shrink-0 transition-all duration-300',
                'w-0 overflow-hidden opacity-0',
                'group-data-[state=open]:w-auto group-data-[state=open]:overflow-visible group-data-[state=open]:opacity-100',
              )}
            >
              {Math.round(usagePercent)}%
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-[320px] rounded-xl p-4 shadow-2xl">
          <div className="flex flex-col gap-3 font-sans text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted/45 text-[9px] font-bold tracking-[0.2em] uppercase">
                ::CONTEXT_WINDOW
              </span>
              <div className="text-text-muted mt-0.5 flex items-baseline justify-between text-[11px] font-semibold">
                <span className="font-mono">
                  {formatTokens(totalTokens)} / {formatTokens(contextLimit)} tokens
                </span>
                <span
                  className={cn(
                    'font-mono font-bold',
                    usagePercent > 90
                      ? 'text-danger'
                      : usagePercent > 70
                        ? 'text-warning'
                        : 'text-accent',
                  )}
                >
                  {usagePercent.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="bg-surface-tertiary/30 ring-border/10 relative h-2 w-full overflow-hidden rounded-full ring-1">
              {usageBreakdown ? (
                <div className="absolute inset-0 flex h-full w-full">
                  <div
                    className="bg-accent/80 h-full"
                    style={{
                      width: `${String(((usageBreakdown.history ?? 0) / contextLimit) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-brand-teal/70 h-full"
                    style={{
                      width: `${String(((usageBreakdown.files ?? 0) / contextLimit) * 100)}%`,
                    }}
                  />
                  <div
                    className="bg-brand-lavender/40 h-full"
                    style={{
                      width: `${String(((usageBreakdown.system ?? 0) / contextLimit) * 100)}%`,
                    }}
                  />
                </div>
              ) : (
                <div
                  className="bg-accent absolute top-0 left-0 h-full rounded-full transition-all duration-300"
                  style={{ width: `${String(usagePercent)}%` }}
                />
              )}
            </div>

            {(usageBreakdown !== undefined ||
              estimatedCost !== undefined ||
              turnsRemaining !== undefined) && (
              <div className="border-border/10 mt-1 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-2">
                {usageBreakdown?.history !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      ::HISTORY
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      {formatTokens(usageBreakdown.history)}
                    </span>
                  </div>
                )}
                {usageBreakdown?.files !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      ::KNOWLEDGE
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      {formatTokens(usageBreakdown.files)}
                    </span>
                  </div>
                )}
                {estimatedCost !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      ::COST
                    </span>
                    <span className="text-text-main font-mono text-[10.5px] font-bold">
                      ${estimatedCost.toFixed(3)}
                    </span>
                  </div>
                )}
                {turnsRemaining !== undefined && (
                  <div className="flex flex-col">
                    <span className="text-text-muted/45 text-[8px] font-bold tracking-[0.15em] uppercase">
                      ::TURNS_LEFT
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
}: {
  isLoadingSession: boolean;
  sessionData: SessionWithCapabilities | null;
  isSwitchingMode: boolean;
  switchMode: (mode: 'local' | 'worktree') => Promise<void>;
  isSwitchingBranch: boolean;
  switchBranch: (branch: string) => Promise<void>;
  branches: string[];
}) {
  const { pushChanges, pullChanges, isPushing, isPulling } = useSession();

  if (!isLoadingSession && !sessionData?.session) return null;

  return (
    <div className="text-text-muted mt-3 flex items-center justify-between px-2 text-[10px] font-bold tracking-widest">
      {isLoadingSession ? (
        <div className="text-text-muted/60 flex items-center gap-1.5 py-1">
          <Monitor className="h-3.5 w-3.5" />
          <span>...</span>
        </div>
      ) : (
        <div className="flex items-center">
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
        </div>
      )}

      {isLoadingSession ? (
        <div className="text-text-muted/60 flex items-center gap-1.5 py-1">
          <GitBranch className="h-3.5 w-3.5" />
          <span>...</span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {sessionData?.session.project?.repoRoot && (
            <div className="border-border/10 bg-surface-tertiary/10 flex shrink-0 items-center overflow-hidden rounded-md border">
              <button
                type="button"
                disabled={isPulling}
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
                className="text-text-muted/55 hover:text-accent hover:bg-surface-tertiary/20 border-border/10 flex h-6 w-6 cursor-pointer items-center justify-center border-r transition-all disabled:opacity-30"
                title="Pull from Remote"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                type="button"
                disabled={isPushing}
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
                className="text-text-muted/55 hover:text-accent hover:bg-surface-tertiary/20 flex h-6 w-6 cursor-pointer items-center justify-center transition-all disabled:opacity-30"
                title="Push to Remote"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
            </div>
          )}

          <CommandDropdown
            value={sessionData?.session.branch ?? ''}
            disabled={isSwitchingBranch}
            onChange={(val) => {
              void switchBranch(val);
            }}
            icon={<GitBranch className="h-3.5 w-3.5" />}
            align="end"
            options={[
              ...branches.map((b) => ({
                value: b,
                label: formatBranchName(b),
              })),
              ...(sessionData?.session.branch &&
              (branches.length === 0 || !branches.includes(sessionData.session.branch))
                ? [
                    {
                      value: sessionData.session.branch,
                      label: formatBranchName(sessionData.session.branch),
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
