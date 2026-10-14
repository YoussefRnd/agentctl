import { useGitDraft, formatGeneratedCommit } from '../model/useGitDraft';
import { useRef, useState } from 'react';
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
  Button,
} from '@agentctl/ui';
import {
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  RepoPullIcon,
  RepoPushIcon,
  ChevronDownIcon,
  GitMergeIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react';

import {
  GitDialogContent,
  GitDialogHeader,
  GitDraftButton,
  GitMessageEditor,
  GitDialogNotice,
} from './GitDialog';

import { formatShortcut } from '@/shared/lib/platform';

type PendingAction = 'commit' | 'commit-push' | 'push' | 'pull' | 'switch' | 'fetch' | null;

interface ReviewGitActionsProps {
  sessionId?: string;
  baseBranch?: string;
  mode?: 'local' | 'worktree';
  branch: string | null;
  branches: string[];
  hasBranchChanges: boolean;
  stagedCount: number;
  unstagedCount: number;
  uncommittedCount?: number;
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
  onCommit: (message: string, includeUnstaged?: boolean) => Promise<void>;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
  onOpenPullRequestDialog: () => void;
  onFetch?: () => Promise<void>;
  onCreateBranch?: (name: string) => Promise<void>;
  lastFetchedAt?: string | null;
  workspaceBusy?: boolean;
  existingPullRequest?: { number: number; url: string };
  pullRequestBlockedReason?: string;
  onApplySession: () => void;
  onDiscardChanges: () => void;
}

export function ReviewGitActions({
  sessionId = '',
  baseBranch = 'main',
  mode = 'worktree',
  branch,
  branches,
  hasBranchChanges,
  stagedCount,
  unstagedCount,
  uncommittedCount,
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
  onPush,
  onPull,
  onOpenPullRequestDialog,
  onFetch,
  onCreateBranch,
  lastFetchedAt,
  workspaceBusy = false,
  existingPullRequest,
  pullRequestBlockedReason,
  onApplySession,
  onDiscardChanges,
}: ReviewGitActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const inFlight = useRef(false);
  const [allowBaseBranchPush, setAllowBaseBranchPush] = useState(() => {
    try {
      return localStorage.getItem('agentctl.allowBaseBranchPush') === 'true';
    } catch {
      return false;
    }
  });
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [commitStep, setCommitStep] = useState('');
  const [pushRetry, setPushRetry] = useState<{ sessionId: string; branch: string | null } | null>(
    null,
  );
  const needsPushRetry =
    pushRetry !== null && pushRetry.sessionId === sessionId && pushRetry.branch === branch;

  const includedCount = includeUnstaged
    ? (uncommittedCount ?? stagedCount + unstagedCount)
    : stagedCount;
  const draft = useGitDraft(
    sessionId,
    commitDialogOpen,
    { kind: 'commit', includeUnstaged },
    commitMessage,
  );
  // Agent activity blocks Git mutations, but must not trap users in an overlay.
  const isGitActionPending = pendingAction !== null;
  const isBusy = isGitActionPending || workspaceBusy || draft.isGenerating;
  const isDiverged = aheadCount > 0 && behindCount > 0;
  const publishAfterCommit = pushAfterCommit && canPush;
  const pushBlockedReason = !canPush
    ? 'Connect a Git remote and check out a branch before pushing.'
    : isDiverged
      ? 'Local and remote history have diverged. Resolve the divergence before pushing or pulling.'
      : isBaseBranch && !allowBaseBranchPush
        ? 'Allow pushing to the base branch before publishing your commits.'
        : undefined;
  const changePushPreference = (allowed: boolean) => {
    setAllowBaseBranchPush(allowed);
    try {
      localStorage.setItem('agentctl.allowBaseBranchPush', String(allowed));
    } catch {
      /* Storage can be unavailable. */
    }
  };

  const run = async (
    action: Exclude<PendingAction, null>,
    operation: () => Promise<void>,
    closeOnSuccess = true,
  ) => {
    if (inFlight.current || workspaceBusy || draft.isGenerating) return;
    inFlight.current = true;
    try {
      setError(null);
      setFeedback(null);
      setPendingAction(action);
      await operation();
      if (action === 'fetch') setFeedback('Remote information refreshed.');
      if (action === 'pull') setFeedback('Remote changes pulled into this branch.');
      if (action === 'push') {
        setFeedback('Commits pushed to the remote.');
        setPushRetry(null);
      }
      if (action === 'commit') setFeedback('Changes committed locally.');
      if (action === 'commit-push') setFeedback('Changes committed and pushed to the remote.');
      if (closeOnSuccess) {
        setCommitDialogOpen(false);
        setSyncOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setPendingAction(null);
      setCommitStep('');
    }
  };

  const retryPush = async () => {
    if (!needsPushRetry || pushBlockedReason) return;
    await run('push', async () => {
      await onPush();
      setPushRetry(null);
    });
  };

  const commit = async (pushAfterCommit: boolean) => {
    if (needsPushRetry) {
      await retryPush();
      return;
    }
    if (includedCount === 0 || (pushAfterCommit && pushBlockedReason)) return;
    await run(pushAfterCommit ? 'commit-push' : 'commit', async () => {
      let finalMessage = commitMessage.trim();
      if (!finalMessage && sessionId) {
        const generated = await draft.generate();
        if (!generated)
          throw new Error('Could not generate a message. Try again or enter one manually.');
        finalMessage = formatGeneratedCommit(generated);
        onCommitMessageChange(finalMessage);
      }
      if (!finalMessage) throw new Error('Enter a commit message');
      setCommitStep('Committing…');
      await onCommit(finalMessage, includeUnstaged);
      if (pushAfterCommit) {
        setPushRetry({ sessionId, branch });
        setCommitStep('Pushing…');
        try {
          await onPush();
          setPushRetry(null);
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
      <div className="@container w-full min-w-0">
        <div
          role="group"
          aria-label="Git workflow"
          className="grid w-full min-w-0 grid-cols-2 gap-1.5 @min-[20rem]:grid-cols-4"
        >
          <button
            type="button"
            aria-label="Commit"
            disabled={isGitActionPending}
            onClick={() => {
              setMenuOpen(false);
              setSyncOpen(false);
              setError(null);
              setCommitDialogOpen(true);
            }}
            className="bg-accent text-brand-crust hover:bg-accent/90 inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors disabled:opacity-40"
          >
            <GitCommitIcon className="h-3.5 w-3.5 shrink-0" />
            Commit
          </button>
          <Popover
            open={syncOpen}
            onOpenChange={(open) => {
              setSyncOpen(open);
              if (open) {
                setMenuOpen(false);
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Sync"
                className="border-border/35 bg-surface/40 text-text-main hover:bg-surface-secondary inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 text-xs transition-colors"
              >
                {pendingAction === 'fetch' ||
                pendingAction === 'push' ||
                pendingAction === 'pull' ? (
                  <SyncIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <SyncIcon className="h-3.5 w-3.5 shrink-0" />
                )}
                Sync
                <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-72 rounded-xl p-1.5">
              <div className="border-border/20 mb-1.5 space-y-1 border-b px-2.5 pt-1.5 pb-3">
                <p className="text-text-main text-xs font-semibold">Sync branch</p>
                <p
                  title={branch ?? undefined}
                  className="text-text-muted truncate font-mono text-xs"
                >
                  {branch ?? 'No branch checked out'}
                </p>
                {canPush && (
                  <p className="text-text-muted text-xs">
                    {hasUpstream
                      ? `${aheadCount} ahead · ${behindCount} behind`
                      : 'This branch has not been published yet.'}
                  </p>
                )}
                {!canPush && (
                  <p className="text-text-muted text-xs">
                    Connect a Git remote to synchronize this branch.
                  </p>
                )}
              </div>
              <ActionRow
                icon={<SyncIcon className="h-4 w-4" />}
                label={pendingAction === 'fetch' ? 'Fetching…' : 'Fetch updates'}
                description="Refresh remote information without changing files"
                disabled={!canPush || !onFetch || isBusy}
                onClick={() => {
                  if (onFetch) void run('fetch', onFetch, false);
                }}
              />
              <ActionRow
                icon={<RepoPullIcon className="h-4 w-4" />}
                label={pendingAction === 'pull' ? 'Pulling…' : 'Pull changes'}
                description={
                  behindCount > 0
                    ? `Bring ${behindCount} remote ${behindCount === 1 ? 'commit' : 'commits'} into this branch`
                    : 'No incoming commits in the last fetched state'
                }
                disabled={!canPush || behindCount === 0 || isDiverged || isBusy}
                onClick={() => {
                  void run('pull', onPull);
                }}
              />
              <ActionRow
                icon={<RepoPushIcon className="h-4 w-4" />}
                label={pendingAction === 'push' ? 'Pushing…' : 'Push commits'}
                description={
                  hasUpstream
                    ? `Publish ${aheadCount} local ${aheadCount === 1 ? 'commit' : 'commits'}`
                    : 'Publish this branch and set up tracking'
                }
                disabled={!!pushBlockedReason || (hasUpstream && aheadCount === 0) || isBusy}
                onClick={() => {
                  void run('push', onPush);
                }}
              />
              {isBaseBranch && canPush && (
                <BaseBranchPushPreference
                  allowed={allowBaseBranchPush}
                  disabled={isBusy}
                  onChange={changePushPreference}
                />
              )}
              {isDiverged && (
                <p role="status" className="text-warning px-2.5 py-2 text-xs">
                  Local and remote history have diverged. Resolve the divergence before pushing or
                  pulling.
                </p>
              )}
              {workspaceBusy && (
                <p role="status" className="text-text-muted px-2.5 py-2 text-xs">
                  Stop the active turn before syncing.
                </p>
              )}
              {error && (
                <div className="px-2.5 py-2">
                  <GitDialogNotice>{error}</GitDialogNotice>
                </div>
              )}
              {feedback && (
                <div className="px-2.5 py-2">
                  <GitDialogNotice tone="muted">{feedback}</GitDialogNotice>
                </div>
              )}
              <p className="text-text-muted/70 border-border/20 mt-1.5 border-t px-2.5 pt-2 pb-1 text-[10px]">
                {lastFetchedAt
                  ? `Last fetched ${new Date(lastFetchedAt).toLocaleString()}`
                  : 'Remote information has not been refreshed yet.'}
              </p>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            disabled={!hasBranchChanges || isLoadingGitStatus || isBusy}
            onClick={onApplySession}
            className="border-border/35 bg-surface/40 text-text-main hover:bg-surface-secondary inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs transition-colors disabled:opacity-40"
            title={
              mode === 'worktree'
                ? `Choose a destination branch (default: ${baseBranch})`
                : 'Finish this session on the current branch'
            }
          >
            <GitMergeIcon className="h-3.5 w-3.5 shrink-0" />
            {mode === 'worktree' ? 'Merge…' : 'Finish…'}
          </button>
          <Popover
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (open) {
                setSyncOpen(false);
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Session actions"
                className="text-text-muted hover:text-text-main hover:bg-surface-secondary inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-xs transition-colors"
              >
                Session <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-64 rounded-xl p-1.5">
              <ActionRow
                icon={<GitBranchIcon className="h-4 w-4" />}
                label="Switch or create branch"
                disabled={isBusy}
                onClick={() => {
                  setMenuOpen(false);
                  setError(null);
                  setBranchDialogOpen(true);
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
              {pullRequestBlockedReason && !existingPullRequest && (
                <p className="text-text-muted px-2.5 pb-2 text-xs">{pullRequestBlockedReason}</p>
              )}
              <div className="border-border/20 mt-1.5 border-t pt-1.5">
                <ActionRow
                  icon={<TrashIcon className="h-4 w-4" />}
                  label="Discard session changes"
                  danger
                  disabled={!hasBranchChanges || isLoadingGitStatus || isBusy}
                  onClick={() => {
                    setMenuOpen(false);
                    onDiscardChanges();
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {!syncOpen && !commitDialogOpen && !branchDialogOpen && (
          <>
            {(pendingAction === 'fetch' ||
              pendingAction === 'push' ||
              pendingAction === 'pull') && (
              <p role="status" className="text-text-muted mt-2 text-xs">
                {pendingAction === 'fetch'
                  ? 'Fetching remote updates…'
                  : pendingAction === 'push'
                    ? 'Pushing commits…'
                    : 'Pulling remote changes…'}
              </p>
            )}
            {error && (
              <div className="mt-2">
                <GitDialogNotice>{error}</GitDialogNotice>
              </div>
            )}
            {feedback && (
              <div className="mt-2">
                <GitDialogNotice tone="muted">{feedback}</GitDialogNotice>
              </div>
            )}
          </>
        )}
      </div>
      <Dialog
        open={branchDialogOpen}
        onOpenChange={(open) => {
          if (!isGitActionPending) {
            setBranchDialogOpen(open);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch or create branch</DialogTitle>
            <DialogDescription>
              Switching requires a clean workspace. Creating a branch keeps your current files and
              changes.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <input
              aria-label="New branch name"
              value={newBranch}
              onChange={(event) => setNewBranch(event.target.value)}
              placeholder="feature/my-change"
              disabled={isBusy}
              className="border-border bg-surface-secondary text-text-main min-w-0 flex-1 rounded border px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!newBranch.trim() || !onCreateBranch || isBusy}
              className="bg-accent text-brand-mantle shrink-0 rounded px-3 py-2 text-xs font-medium disabled:opacity-40"
              onClick={() => {
                if (onCreateBranch)
                  void run(
                    'switch',
                    async () => {
                      await onCreateBranch(newBranch.trim());
                      setNewBranch('');
                      setBranchDialogOpen(false);
                    },
                    false,
                  );
              }}
            >
              Create branch
            </button>
          </div>
          <div className="max-h-60 overflow-auto">
            {branches.map((name) => (
              <button
                key={name}
                title={name}
                type="button"
                disabled={isBusy || name === branch}
                className="hover:bg-surface-secondary block w-full truncate rounded p-2 text-left text-sm"
                onClick={() => {
                  void run(
                    'switch',
                    async () => {
                      await onSwitchBranch(name);
                      setBranchDialogOpen(false);
                    },
                    false,
                  );
                }}
              >
                {name}
                {name === branch ? ' (current)' : ''}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-danger text-xs [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={commitDialogOpen}
        onOpenChange={(open) => {
          if (!isGitActionPending) {
            setError(null);
            setCommitDialogOpen(open);
          }
        }}
      >
        <GitDialogContent
          busy={isGitActionPending}
          footer={
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={isGitActionPending}
                onClick={() => setCommitDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                size="sm"
                aria-label={
                  needsPushRetry
                    ? 'Retry push'
                    : publishAfterCommit
                      ? 'Commit and push'
                      : 'Commit changes'
                }
                disabled={
                  isBusy ||
                  (needsPushRetry
                    ? !!pushBlockedReason
                    : includedCount === 0 ||
                      (!commitMessage.trim() && !sessionId) ||
                      (publishAfterCommit && !!pushBlockedReason))
                }
                onClick={() => {
                  void commit(publishAfterCommit);
                }}
                className="h-auto min-h-8 min-w-0 gap-2 py-2 text-xs whitespace-normal"
              >
                {isGitActionPending ? (
                  <SyncIcon className="h-3.5 w-3.5 animate-spin" />
                ) : needsPushRetry ? (
                  <RepoPushIcon className="h-3.5 w-3.5" />
                ) : (
                  <GitCommitIcon className="h-3.5 w-3.5" />
                )}
                <span>
                  {pendingAction === 'commit' || pendingAction === 'commit-push'
                    ? draft.isGenerating
                      ? 'Generating…'
                      : commitStep || 'Committing…'
                    : pendingAction === 'push'
                      ? 'Pushing…'
                      : needsPushRetry
                        ? 'Retry push'
                        : publishAfterCommit
                          ? 'Commit and push'
                          : 'Commit'}
                </span>
                {!needsPushRetry && (
                  <kbd className="font-mono text-[10px] opacity-65">{formatShortcut('↵')}</kbd>
                )}
              </Button>
            </>
          }
        >
          <GitDialogHeader
            icon={<GitCommitIcon size={18} />}
            title="Commit changes"
            description="Save the selected changes to this branch."
          />
          <div className="bg-surface-secondary/40 flex min-w-0 items-center gap-2 rounded-lg px-3 py-2">
            <GitBranchIcon className="text-text-muted h-3.5 w-3.5 shrink-0" />
            <span
              title={branch ?? undefined}
              className="text-text-main min-w-0 flex-1 truncate font-mono text-xs"
            >
              {branch ?? 'No branch'}
            </span>
            <span className="text-text-muted shrink-0 text-xs">
              {needsPushRetry
                ? 'Committed'
                : `${includedCount} ${includedCount === 1 ? 'file' : 'files'}`}
            </span>
          </div>
          {!needsPushRetry && (
            <>
              <GitMessageEditor
                id="review-commit-message"
                value={commitMessage}
                onChange={(event) => onCommitMessageChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void commit(publishAfterCommit);
                  }
                }}
                disabled={isBusy}
                aria-label="Commit message"
                aria-required={!sessionId}
                placeholder="Describe these changes…"
                autoFocus
                hint={
                  sessionId
                    ? 'Leave blank to generate a message with your configured model.'
                    : undefined
                }
                action={
                  sessionId && (
                    <GitDraftButton
                      pending={draft.isGenerating}
                      disabled={isBusy || includedCount === 0}
                      onClick={() => {
                        setError(null);
                        void draft.generate().then((result) => {
                          if (result) onCommitMessageChange(formatGeneratedCommit(result));
                        });
                      }}
                    />
                  )
                }
              />
              <div className="space-y-2">
                <label className="text-text-main flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={includeUnstaged}
                    onChange={(event) => setIncludeUnstaged(event.target.checked)}
                    disabled={unstagedCount === 0 || isBusy}
                    className="accent-accent mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <span>
                    Include unstaged changes{' '}
                    <span className="text-text-muted">({unstagedCount})</span>
                  </span>
                </label>
                <p className="text-text-muted text-xs">
                  {includeUnstaged
                    ? 'Includes staged, unstaged, and untracked files.'
                    : 'Only staged changes will be committed.'}
                </p>
                <p className="text-text-muted text-xs">
                  Working tree:{' '}
                  <span className="text-success font-mono">+{additions.toLocaleString()}</span>{' '}
                  <span className="text-danger font-mono">−{deletions.toLocaleString()}</span>
                </p>
              </div>
              {canPush && (
                <div className="border-border/20 space-y-2 border-t pt-3">
                  <label className="text-text-main flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={pushAfterCommit}
                      onChange={(event) => setPushAfterCommit(event.target.checked)}
                      disabled={isBusy}
                      className="accent-accent mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <span>
                      Push after committing{' '}
                      <span className="text-text-muted mt-0.5 block">
                        Publish this commit to the remote.
                      </span>
                    </span>
                  </label>
                  {publishAfterCommit && isBaseBranch && (
                    <BaseBranchPushPreference
                      allowed={allowBaseBranchPush}
                      disabled={isBusy}
                      onChange={changePushPreference}
                    />
                  )}
                  {publishAfterCommit && pushBlockedReason && (
                    <p role="status" className="text-warning text-xs">
                      {pushBlockedReason}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
          {needsPushRetry && (
            <>
              <GitDialogNotice tone="muted">
                Your commit is saved locally. Retry the push to publish it.
              </GitDialogNotice>
              {isBaseBranch && (
                <BaseBranchPushPreference
                  allowed={allowBaseBranchPush}
                  disabled={isBusy}
                  onChange={changePushPreference}
                />
              )}
              {pushBlockedReason && (
                <GitDialogNotice tone="warning">{pushBlockedReason}</GitDialogNotice>
              )}
              {includedCount > 0 && (
                <button
                  type="button"
                  className="text-accent text-xs disabled:opacity-40"
                  disabled={isBusy}
                  onClick={() => {
                    setPushRetry(null);
                    setError(null);
                  }}
                >
                  Commit more changes
                </button>
              )}
            </>
          )}
          {workspaceBusy && (
            <p role="status" className="text-text-muted text-xs">
              {needsPushRetry
                ? 'Stop the active turn before pushing.'
                : 'Stop the active turn before committing.'}
            </p>
          )}
          {(error || draft.error) && <GitDialogNotice>{draft.error || error}</GitDialogNotice>}
        </GitDialogContent>
      </Dialog>
    </>
  );
}

function BaseBranchPushPreference({
  allowed,
  disabled,
  onChange,
}: {
  allowed: boolean;
  disabled: boolean;
  onChange: (allowed: boolean) => void;
}) {
  return (
    <label className="text-text-muted flex items-start gap-2 px-2.5 py-2 text-xs">
      <input
        type="checkbox"
        checked={allowed}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-accent mt-0.5 h-3.5 w-3.5 shrink-0"
      />
      <span>Allow pushing to the base branch</span>
    </label>
  );
}

function ActionRow({
  icon,
  label,
  description,
  danger = false,
  disabled = false,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
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
      className={`flex min-h-9 w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-40 ${danger ? 'text-danger hover:bg-danger/10' : 'text-text-main hover:bg-surface-secondary/70'}`}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center opacity-70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="text-text-muted mt-0.5 block text-[11px] leading-relaxed">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
