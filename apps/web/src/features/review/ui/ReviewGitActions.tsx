import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@agentctl/ui';
import {
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  RepoPullIcon,
  RepoPushIcon,
} from '@primer/octicons-react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

type PendingAction = 'commit' | 'commit-push' | 'push' | 'pull' | 'switch' | null;

interface ReviewGitActionsProps {
  branch: string | null;
  branches: string[];
  remoteName: string | null;
  hasBranchChanges: boolean;
  stagedCount: number;
  unstagedCount: number;
  additions: number;
  deletions: number;
  aheadCount: number;
  behindCount: number;
  hasUpstream: boolean;
  isBaseBranch: boolean;
  canPush: boolean;
  isLoadingGitStatus: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onSwitchBranch: (branch: string) => Promise<void>;
  onCommit: () => Promise<void>;
  onStageAll: () => Promise<void>;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
  onOpenPullRequestDialog: () => void;
  onGenerateSummary?: () => Promise<string>;
  existingPullRequest?: { number: number; url: string };
  pullRequestBlockedReason?: string;
  onApplySession: () => void;
  onDiscardChanges: () => void;
}

export function ReviewGitActions({
  branch,
  branches,
  remoteName: _remoteName,
  hasBranchChanges: _hasBranchChanges,
  stagedCount,
  unstagedCount,
  additions,
  deletions,
  aheadCount,
  behindCount,
  hasUpstream,
  isBaseBranch,
  canPush,
  isLoadingGitStatus,
  commitMessage,
  onCommitMessageChange,
  onSwitchBranch,
  onCommit,
  onStageAll,
  onPush,
  onPull,
  onOpenPullRequestDialog,
  onGenerateSummary,
  existingPullRequest,
  pullRequestBlockedReason,
  onApplySession: _onApplySession,
  onDiscardChanges: _onDiscardChanges,
}: ReviewGitActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const includedCount = stagedCount + (includeUnstaged ? unstagedCount : 0);
  const isBusy = pendingAction !== null;
  const isDiverged = aheadCount > 0 && behindCount > 0;

  const run = async (
    action: Exclude<PendingAction, null>,
    operation: () => Promise<void>,
    closeOnSuccess = true,
  ) => {
    try {
      setError(null);
      setPendingAction(action);
      await operation();
      if (closeOnSuccess) {
        setCommitDialogOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  const commit = async (pushAfterCommit: boolean) => {
    if (includedCount === 0) return;
    await run(pushAfterCommit ? 'commit-push' : 'commit', async () => {
      let finalMessage = commitMessage.trim();
      if (!finalMessage && onGenerateSummary) {
        finalMessage = await onGenerateSummary();
        onCommitMessageChange(finalMessage);
      }
      if (!finalMessage) {
        finalMessage = 'feat: update workspace changes';
        onCommitMessageChange(finalMessage);
      }

      if (includeUnstaged && unstagedCount > 0) {
        await onStageAll();
      }
      await onCommit();
      if (pushAfterCommit) {
        try {
          await onPush();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Commit succeeded, but push failed: ${message}`);
        }
      }
    });
  };

  const openPullRequest = () => {
    setMenuOpen(false);
    if (existingPullRequest) {
      window.open(existingPullRequest.url, '_blank', 'noopener,noreferrer');
    } else {
      onOpenPullRequestDialog();
    }
  };

  return (
    <>
      {/* Split button: Direct Commit + Dropdown */}
      <div className="border-border/25 bg-surface/40 hover:border-border/50 inline-flex h-7.5 items-center overflow-hidden rounded-lg border transition-colors">
        <button
          type="button"
          aria-label="Commit"
          onClick={() => {
            setError(null);
            setCommitDialogOpen(true);
          }}
          className="text-text-muted hover:bg-surface/70 hover:text-text-main flex h-full cursor-pointer items-center px-2 transition-colors"
          title="Commit or push"
        >
          <GitCommitIcon className="h-3.5 w-3.5" />
        </button>

        <Popover
          open={menuOpen}
          onOpenChange={(nextOpen) => {
            if (!isBusy) {
              setMenuOpen(nextOpen);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Git actions"
              className="text-text-muted hover:bg-surface/70 hover:text-text-main border-border/20 flex h-full cursor-pointer items-center border-l px-1.5 transition-colors"
              title="More Git actions"
            >
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="border-border/30 bg-brand-mantle/98 w-64 rounded-xl border p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <ActionRow
              icon={<GitCommitIcon className="h-4 w-4" />}
              label="Commit or push"
              onClick={() => {
                setMenuOpen(false);
                setError(null);
                setCommitDialogOpen(true);
              }}
            />
            <ActionRow
              icon={<GitPullRequestIcon className="h-4 w-4" />}
              label={
                existingPullRequest
                  ? `Open pull request #${existingPullRequest.number}`
                  : 'Create pull request'
              }
              disabled={
                !existingPullRequest &&
                (pullRequestBlockedReason !== undefined || isLoadingGitStatus || isBusy)
              }
              title={pullRequestBlockedReason}
              onClick={openPullRequest}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Codex-style Commit Popover Dialog */}
      <Dialog
        open={commitDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isBusy) {
            setError(null);
            setCommitDialogOpen(nextOpen);
          }
        }}
      >
        <DialogContent className="max-w-sm overflow-hidden rounded-2xl p-0 shadow-2xl">
          <div className="space-y-3 p-4">
            <DialogHeader className="sr-only">
              <DialogTitle>Commit changes</DialogTitle>
              <DialogDescription>Commit changes to your branch or push</DialogDescription>
            </DialogHeader>

            {/* Top row: Branch selector */}
            <div className="flex items-center justify-between">
              <Popover open={branchMenuOpen} onOpenChange={setBranchMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Current branch"
                    className="border-border/20 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/70 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 font-mono text-xs font-medium transition-colors"
                  >
                    <GitBranchIcon className="text-text-muted h-3.5 w-3.5" />
                    <span className="max-w-44 truncate">{branch ?? 'main'}</span>
                    <ChevronDown className="text-text-muted/60 h-3 w-3" />
                  </button>
                </PopoverTrigger>

                <PopoverContent
                  align="start"
                  sideOffset={4}
                  className="border-border/30 bg-brand-mantle/98 w-56 rounded-xl border p-1 shadow-2xl backdrop-blur-xl"
                >
                  <div className="text-text-muted/70 px-2 py-1 text-[10px] font-semibold tracking-wider uppercase">
                    Commit to
                  </div>
                  <div className="max-h-48 space-y-0.5 overflow-y-auto">
                    {branches.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setBranchMenuOpen(false);
                          if (b !== branch) {
                            void run('switch', () => onSwitchBranch(b), false);
                          }
                        }}
                        className="hover:bg-surface-secondary/70 text-text-main flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-left font-mono text-xs transition-colors"
                      >
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <GitBranchIcon className="text-text-muted h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{b}</span>
                        </span>
                        {b === branch && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="text-text-muted flex items-center gap-1.5 font-mono text-[10px]">
                {aheadCount > 0 && <span className="text-success">↑{aheadCount}</span>}
                {behindCount > 0 && <span className="text-warning">↓{behindCount}</span>}
              </div>
            </div>

            {/* Commit message input */}
            <div>
              <textarea
                id="review-commit-message"
                value={commitMessage}
                onChange={(event) => {
                  onCommitMessageChange(event.target.value);
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void commit(false);
                  }
                }}
                disabled={isBusy}
                rows={3}
                aria-label="Commit message"
                placeholder="Message (leave blank to generate)..."
                autoFocus
                className="border-border/20 bg-surface-secondary/25 text-text-main placeholder:text-text-muted/45 focus:border-accent/45 w-full resize-none rounded-xl border px-3 py-2 text-xs leading-relaxed transition-colors outline-none disabled:opacity-50"
              />
            </div>

            {/* Include unstaged checkbox & diff stats */}
            <label className="text-text-main flex cursor-pointer items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeUnstaged}
                  onChange={(event) => {
                    setIncludeUnstaged(event.target.checked);
                  }}
                  disabled={unstagedCount === 0 || isBusy}
                  className="accent-accent h-3.5 w-3.5 cursor-pointer"
                />
                <span className="text-text-muted/90 text-xs select-none">
                  Include unstaged changes
                </span>
              </span>
              <span className="font-mono text-xs">
                <span className="text-success">+{additions.toLocaleString()}</span>{' '}
                <span className="text-danger">-{deletions.toLocaleString()}</span>
              </span>
            </label>

            {error && (
              <p className="border-danger/20 bg-danger/10 text-danger rounded-lg border p-2 text-xs">
                {error}
              </p>
            )}

            {/* Stacked Action Options */}
            <div className="border-border/15 space-y-1 border-t pt-2">
              {/* 1. Commit primary action */}
              <button
                type="button"
                disabled={includedCount === 0 || isBusy}
                onClick={() => {
                  void commit(false);
                }}
                className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-main flex h-9 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-35"
              >
                <span className="flex items-center gap-2.5">
                  {pendingAction === 'commit' ? (
                    <Loader2 className="text-accent h-4 w-4 animate-spin" />
                  ) : (
                    <GitCommitIcon className="h-4 w-4" />
                  )}
                  <span>Commit</span>
                </span>
                <kbd className="border-border/20 bg-surface/80 text-text-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
                  Ctrl+↵
                </kbd>
              </button>

              {/* 2. Commit and push action */}
              <button
                type="button"
                disabled={includedCount === 0 || !canPush || isBaseBranch || isDiverged || isBusy}
                onClick={() => {
                  void commit(true);
                }}
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 flex h-9 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-35"
              >
                <span className="flex items-center gap-2.5">
                  {pendingAction === 'commit-push' ? (
                    <Loader2 className="text-accent h-4 w-4 animate-spin" />
                  ) : (
                    <RepoPushIcon className="h-4 w-4 opacity-75" />
                  )}
                  <span>Commit and push</span>
                </span>
              </button>

              {/* 3. Push action (if clean or ahead) */}
              {canPush && (aheadCount > 0 || !hasUpstream) && (
                <button
                  type="button"
                  disabled={isBaseBranch || isDiverged || isBusy}
                  onClick={() => {
                    void run('push', onPush);
                  }}
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 flex h-9 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-35"
                >
                  <span className="flex items-center gap-2.5">
                    {pendingAction === 'push' ? (
                      <Loader2 className="text-accent h-4 w-4 animate-spin" />
                    ) : (
                      <RepoPushIcon className="h-4 w-4 opacity-75" />
                    )}
                    <span>Push</span>
                  </span>
                  {aheadCount > 0 && (
                    <span className="text-text-muted/60 font-mono text-[10px]">
                      {aheadCount} ahead
                    </span>
                  )}
                </button>
              )}

              {/* 4. Pull action (if behind) */}
              {behindCount > 0 && (
                <button
                  type="button"
                  disabled={!canPush || isDiverged || isBusy}
                  onClick={() => {
                    void run('pull', onPull);
                  }}
                  className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 flex h-9 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-35"
                >
                  <span className="flex items-center gap-2.5">
                    {pendingAction === 'pull' ? (
                      <Loader2 className="text-accent h-4 w-4 animate-spin" />
                    ) : (
                      <RepoPullIcon className="h-4 w-4 opacity-75" />
                    )}
                    <span>{isDiverged ? 'Resolve divergence' : 'Pull remote changes'}</span>
                  </span>
                  <span className="text-warning font-mono text-[10px]">{behindCount} behind</span>
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActionRow({
  icon,
  label,
  detail,
  pending = false,
  danger = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  pending?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-35 ${
        danger ? 'text-danger hover:bg-danger/10' : 'text-text-main hover:bg-surface-secondary/70'
      }`}
    >
      <span className="text-text-muted flex h-4 w-4 items-center justify-center">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{pending ? 'Working...' : label}</span>
      {detail && <span className="text-text-muted/60 font-mono text-[10px]">{detail}</span>}
    </button>
  );
}
