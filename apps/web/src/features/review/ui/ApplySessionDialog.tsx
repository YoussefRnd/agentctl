import {
  SyncIcon,
  CheckIcon,
  GitMergeIcon,
  GitBranchIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  AlertIcon,
} from '@primer/octicons-react';
import { useGitDraft, formatGeneratedCommit } from '../model/useGitDraft';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, assertApiStatus } from '@agentctl/api-client';
import { Dialog, Button } from '@agentctl/ui';
import {
  GitDialogContent,
  GitDialogHeader,
  GitDraftButton,
  GitMessageEditor,
  GitDialogNotice,
} from './GitDialog';

import { sessionKeys } from '@/shared/lib/queryKeys';

interface ApplySessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  mode: 'local' | 'worktree';
  currentBranch?: string;
  baseBranch: string;
  branches?: string[];
  uncommittedCount: number;
  workspaceBusy: boolean;
  defaultMessage?: string;
  commitMessage: string;
  onCommitMessageChange: (val: string) => void;
  onCommitAll: (message: string) => Promise<void>;
  onConfirm: (message: string, targetBranch?: string) => Promise<void>;
}

export function ApplySessionDialog({
  open,
  onOpenChange,
  sessionId,
  mode,
  currentBranch,
  baseBranch,
  branches = [],
  uncommittedCount,
  workspaceBusy,
  defaultMessage,
  commitMessage,
  onCommitMessageChange,
  onCommitAll,
  onConfirm,
}: ApplySessionDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const isWorktree = mode === 'worktree';
  const [targetBranch, setTargetBranch] = useState(baseBranch);
  const draft = useGitDraft(
    sessionId,
    open,
    isWorktree ? { kind: 'merge', targetBranch } : { kind: 'commit', includeUnstaged: true },
    commitMessage,
  );
  const destinations = [...new Set([baseBranch, ...branches])].filter(
    (name) => name !== currentBranch,
  );
  const preview = useQuery({
    queryKey: sessionKeys.mergePreview(sessionId, targetBranch),
    queryFn: async () => {
      const response = await api.getSessionMergePreview({
        params: { id: sessionId },
        query: { targetBranch },
      });
      assertApiStatus(response, 200, 'Could not check merge readiness');
      return response.body;
    },
    enabled: open && isWorktree && !!sessionId && !isSubmitting && !workspaceBusy,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open, sessionId]);
  useEffect(() => {
    setTargetBranch(baseBranch);
  }, [sessionId, baseBranch]);
  const count = isWorktree
    ? (preview.data?.uncommittedCount ?? uncommittedCount)
    : uncommittedCount;
  const needsCommit = count > 0 && !(isWorktree && preview.data?.hasMergeHead);
  const message = commitMessage.trim() || defaultMessage?.trim() || 'Apply session changes';
  const blockedReason = workspaceBusy
    ? 'Stop the active turn before merging or finishing this session.'
    : isWorktree
      ? preview.data?.blockedReason
      : null;
  const checkError = preview.error instanceof Error ? preview.error.message : null;
  const isChecking = isWorktree && (preview.isFetching || !preview.data);
  const hasConflicts = isWorktree && preview.data?.hasConflicts;

  const handleConfirm = async () => {
    if (
      inFlight.current ||
      draft.isGenerating ||
      blockedReason ||
      (isWorktree && (isChecking || checkError))
    )
      return;
    inFlight.current = true;
    setIsSubmitting(true);
    setError(null);
    let committed = false;
    try {
      if (needsCommit) {
        setStep('Committing…');
        await onCommitAll(message);
        committed = true;
      }
      setStep(isWorktree ? 'Merging…' : 'Finishing…');
      await onConfirm(message, isWorktree ? targetBranch : undefined);
      onOpenChange(false);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Failed to apply changes';
      setError(committed ? `Your changes were committed. ${detail}` : detail);
      if (isWorktree) void preview.refetch();
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
      setStep('');
    }
  };

  const actionLabel = hasConflicts
    ? needsCommit
      ? 'Commit all and prepare resolution'
      : 'Prepare conflict resolution'
    : isWorktree
      ? needsCommit
        ? 'Commit all and merge'
        : 'Merge session'
      : needsCommit
        ? 'Commit all and finish'
        : 'Finish session';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!inFlight.current) onOpenChange(nextOpen);
      }}
    >
      <GitDialogContent
        busy={isSubmitting}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                void handleConfirm();
              }}
              disabled={
                isSubmitting ||
                draft.isGenerating ||
                !!blockedReason ||
                (isWorktree && (isChecking || !!checkError))
              }
              className="h-auto min-h-8 min-w-0 gap-1.5 py-2 text-xs whitespace-normal"
            >
              {isSubmitting ? (
                <SyncIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : isWorktree ? (
                <GitMergeIcon className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {isSubmitting ? step : actionLabel}
              </span>
            </Button>
          </>
        }
      >
        <GitDialogHeader
          icon={isWorktree ? <GitMergeIcon size={18} /> : <CheckIcon size={18} />}
          title={isWorktree ? 'Merge session' : 'Finish session'}
          description={
            isWorktree
              ? 'Combine session changes into one commit on the destination branch.'
              : 'Save your changes and finish this session on the current branch.'
          }
        />
        <div className="border-border/20 bg-surface-secondary/40 grid min-w-0 gap-3 rounded-lg border p-3 sm:flex sm:items-center">
          <div className="min-w-0 flex-1 space-y-1.5">
            <span className="text-text-muted block text-xs">
              {isWorktree ? 'From' : 'Current branch'}
            </span>
            <div className="text-text-main flex min-w-0 items-center gap-1.5">
              <GitBranchIcon className="text-text-muted h-3.5 w-3.5 shrink-0" />
              <span title={currentBranch} className="min-w-0 truncate font-mono text-xs">
                {currentBranch || 'Current branch'}
              </span>
            </div>
          </div>
          {isWorktree && (
            <>
              <ArrowRightIcon className="text-text-muted hidden h-4 w-4 shrink-0 sm:block" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <label htmlFor="merge-destination" className="text-text-muted block text-xs">
                  Merge into
                </label>
                <div className="relative min-w-0">
                  <select
                    id="merge-destination"
                    aria-label="Destination branch"
                    title={targetBranch}
                    value={targetBranch}
                    disabled={
                      isSubmitting ||
                      draft.isGenerating ||
                      workspaceBusy ||
                      !!preview.data?.hasMergeHead
                    }
                    onChange={(event) => {
                      setError(null);
                      setTargetBranch(event.target.value);
                    }}
                    className="border-border/30 bg-background/40 text-text-main focus:border-accent/50 block h-8 w-full min-w-0 appearance-none truncate rounded-md border pr-7 pl-2 font-mono text-xs outline-none disabled:opacity-50"
                  >
                    {destinations.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon className="text-text-muted pointer-events-none absolute top-2 right-2 h-4 w-4" />
                </div>
              </div>
            </>
          )}
        </div>

        {isWorktree && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs">
            <span role="status" className="text-text-muted inline-flex items-center gap-1.5">
              {isSubmitting ? (
                <>
                  <SyncIcon className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  {step}
                </>
              ) : workspaceBusy || checkError || blockedReason ? (
                <>
                  <AlertIcon className="text-warning h-3.5 w-3.5 shrink-0" /> Merge unavailable
                </>
              ) : isChecking ? (
                <>
                  <SyncIcon className="h-3.5 w-3.5 shrink-0 animate-spin" /> Checking readiness…
                </>
              ) : hasConflicts ? (
                <>
                  <AlertIcon className="text-warning h-3.5 w-3.5 shrink-0" /> Conflicts to resolve
                </>
              ) : (
                <>
                  <CheckIcon className="text-success h-3.5 w-3.5 shrink-0" /> Ready to merge
                </>
              )}
            </span>
            <button
              type="button"
              aria-label="Recheck merge readiness"
              className="text-accent inline-flex items-center gap-1 text-xs disabled:opacity-40"
              disabled={isSubmitting || preview.isFetching || workspaceBusy}
              onClick={() => {
                setError(null);
                void preview.refetch();
              }}
            >
              <SyncIcon className="h-3 w-3" />
              Recheck
            </button>
          </div>
        )}

        {hasConflicts && (
          <div className="border-warning/20 bg-warning/10 space-y-2 rounded-lg border p-3 text-xs [overflow-wrap:anywhere]">
            <p className="text-text-main font-medium">Resolve conflicts before merging</p>
            <p className="text-text-muted">
              Prepare the merge in your source worktree, resolve the files, stage each resolution,
              then retry. <span className="font-mono">{targetBranch}</span> stays unchanged until
              the conflicts are resolved.
            </p>
            <ul className="max-h-28 space-y-1 overflow-y-auto font-mono">
              {preview.data?.conflictingFiles.map((file) => (
                <li key={file} className="break-all">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}
        {isWorktree && preview.data?.hasMergeHead && (
          <p className="text-text-muted text-xs">
            Finish or abort the pending merge before changing its destination.
            {!blockedReason &&
              ' Your staged conflict resolutions will be committed before merging.'}
          </p>
        )}

        <GitMessageEditor
          id="commit-message-input"
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          placeholder={message}
          disabled={isSubmitting || draft.isGenerating}
          autoFocus
          hint={<>Leave blank to use “{defaultMessage?.trim() || 'Apply session changes'}”.</>}
          action={
            <GitDraftButton
              pending={draft.isGenerating}
              disabled={
                isSubmitting ||
                workspaceBusy ||
                !!blockedReason ||
                (isWorktree && (isChecking || !!checkError))
              }
              onClick={() => {
                void draft.generate().then((result) => {
                  if (result) onCommitMessageChange(formatGeneratedCommit(result));
                });
              }}
            />
          }
        />
        {needsCommit && (
          <p className="text-text-muted text-xs">
            Commits all {count} changed {count === 1 ? 'file' : 'files'} first, including staged,
            unstaged, and untracked files in this project.
          </p>
        )}
        <p className="text-text-muted text-xs">
          {isWorktree && !hasConflicts ? 'Finishes the session after merging. ' : ''}
          Changes stay on your computer. Push separately to publish them.
        </p>
        {isWorktree && (
          <details className="border-border/20 text-text-muted border-t pt-3 text-xs">
            <summary className="text-text-main cursor-pointer select-none">Merge details</summary>
            <div className="mt-2 space-y-2 [overflow-wrap:anywhere]">
              <p>Your source worktree and branch are kept until you delete the session.</p>
              {preview.data?.targetPath && <p>Destination: {preview.data.targetPath}</p>}
              {preview.data?.targetPath === null && (
                <p>The destination branch is updated without switching your current checkout.</p>
              )}
            </div>
          </details>
        )}
        {(error || draft.error || checkError || blockedReason) && (
          <GitDialogNotice>{error || draft.error || checkError || blockedReason}</GitDialogNotice>
        )}
      </GitDialogContent>
    </Dialog>
  );
}
