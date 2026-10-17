import { useRef, useState } from 'react';
import { useGitDraft, formatGeneratedCommit } from './useGitDraft';
import type { ReviewGitActionsProps } from './review-git-actions';
type PendingAction = 'commit' | 'commit-push' | 'push' | 'pull' | 'switch' | 'fetch' | null;
/** Owns mutation admission, commit generation and branch-scoped push retry state. */
export function useReviewGitActions({
  sessionId = '',
  branch,
  uncommittedCount,
  stagedCount,
  unstagedCount,
  workspaceBusy,
  aheadCount,
  behindCount,
  canPush,
  isBaseBranch,
  commitMessage,
  onCommitMessageChange,
  onCommit,
  onPush,
}: Pick<
  ReviewGitActionsProps,
  | 'sessionId'
  | 'branch'
  | 'uncommittedCount'
  | 'stagedCount'
  | 'unstagedCount'
  | 'workspaceBusy'
  | 'aheadCount'
  | 'behindCount'
  | 'canPush'
  | 'isBaseBranch'
  | 'commitMessage'
  | 'onCommitMessageChange'
  | 'onCommit'
  | 'onPush'
>) {
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

  return {
    menuOpen,
    setMenuOpen,
    syncOpen,
    setSyncOpen,
    pushAfterCommit,
    setPushAfterCommit,
    commitDialogOpen,
    setCommitDialogOpen,
    branchDialogOpen,
    setBranchDialogOpen,
    newBranch,
    setNewBranch,
    allowBaseBranchPush,
    includeUnstaged,
    setIncludeUnstaged,
    pendingAction,
    error,
    setError,
    feedback,
    commitStep,
    setPushRetry,
    needsPushRetry,
    includedCount,
    draft,
    isGitActionPending,
    isBusy,
    isDiverged,
    publishAfterCommit,
    pushBlockedReason,
    changePushPreference,
    run,
    retryPush,
    commit,
  };
}
