import { useGitDraft } from '../model/useGitDraft';
import { useState, useEffect, useRef } from 'react';
import { Dialog, Input, Button, Spinner } from '@agentctl/ui';
import {
  GitDialogContent,
  GitDialogHeader,
  GitDraftButton,
  GitMessageEditor,
  GitDialogNotice,
} from './GitDialog';
import { GitPullRequestIcon, ArrowRightIcon } from '@primer/octicons-react';

import type { CreatePullRequestResult } from '@agentctl/shared';
import { useGitStatus } from '@/shared/workspace/useGitStatus';

interface CreatePullRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultTitle?: string;
  defaultBaseBranch?: string;
  currentBranch?: string;
  workspaceBusy?: boolean;
  uncommittedCount?: number;
  onSuccess?: (url: string, status: CreatePullRequestResult['status']) => void;
}

export function CreatePullRequestDialog({
  open,
  onOpenChange,
  sessionId,
  defaultTitle = '',
  defaultBaseBranch = 'main',
  currentBranch = 'feature-branch',
  onSuccess,
  workspaceBusy = false,
  uncommittedCount = 0,
}: CreatePullRequestDialogProps) {
  const { gitStatus, createPullRequest, isCreatingPullRequest, isLoading } =
    useGitStatus(sessionId);

  const headBranch = gitStatus.branch ?? currentBranch;
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState('');
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const initializedSession = useRef<string | null>(null);
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isPublishing = isSubmitting || isCreatingPullRequest;
  const [error, setError] = useState<string | null>(null);
  const draft = useGitDraft(
    sessionId,
    open,
    { kind: 'pr', targetBranch: baseBranch },
    JSON.stringify({ title, body, headBranch }),
  );

  useEffect(() => {
    if (open && initializedSession.current !== sessionId) {
      initializedSession.current = sessionId;
      setTitle(defaultTitle);
      setBody('');
      setBaseBranch(defaultBaseBranch);
      setError(null);
    }
  }, [open, sessionId, defaultTitle, defaultBaseBranch]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const gitBlockedReason = isLoading
    ? 'Checking Git status…'
    : gitStatus.isRepo === false
      ? (gitStatus.error ?? 'This workspace is not a Git repository.')
      : !headBranch || headBranch === 'HEAD'
        ? 'Check out a branch before publishing a pull request.'
        : gitStatus.hasPrimaryRemote === false
          ? 'Configure a Git remote before publishing a pull request.'
          : gitStatus.remoteProvider && gitStatus.remoteProvider !== 'github'
            ? 'Pull request creation currently supports GitHub remotes only.'
            : null;
  const blockedReason =
    gitBlockedReason ??
    (workspaceBusy
      ? 'Stop the active turn before publishing a pull request. Your draft is kept.'
      : uncommittedCount > 0
        ? 'Commit your uncommitted changes before publishing. The PR includes committed changes only.'
        : headBranch === baseBranch.trim()
          ? 'Choose a base branch different from the current branch.'
          : null);

  const handleCreate = async () => {
    if (submitting.current || isPublishing || draft.isGenerating || blockedReason) return;
    if (!title.trim()) {
      setError('PR title is required');
      return;
    }
    if (!baseBranch.trim()) {
      setError('Base branch is required');
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      setError(null);
      const result = await createPullRequest({
        title: title.trim(),
        body: body.trim(),
        baseBranch: baseBranch.trim(),
        ...(headBranch ? { headBranch } : {}),
      });

      if (result.status === 'needs_browser') {
        onSuccess?.(result.compareUrl, result.status);
      } else {
        onSuccess?.(result.pr.url, result.status);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting.current && !isPublishing) onOpenChange(next);
      }}
    >
      <GitDialogContent
        busy={isPublishing}
        footer={
          <>
            {' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isPublishing}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                void handleCreate();
              }}
              disabled={
                draft.isGenerating ||
                isPublishing ||
                !!blockedReason ||
                !title.trim() ||
                !baseBranch.trim()
              }
              className="h-auto min-h-8 min-w-0 gap-1.5 py-2 text-xs whitespace-normal"
            >
              {isPublishing ? (
                <>
                  <Spinner aria-hidden="true" className="icon-compact" />
                  <span>Publishing PR…</span>
                </>
              ) : (
                <>
                  <GitPullRequestIcon className="h-3.5 w-3.5" />
                  <span>Push and create PR</span>
                </>
              )}
            </Button>
          </>
        }
      >
        <GitDialogHeader
          icon={<GitPullRequestIcon size={18} />}
          title="Create Pull Request"
          description="Push the committed branch and open a pull request on GitHub."
        />
        <div className="bg-surface-secondary/40 border-border/20 grid min-w-0 gap-2 rounded-lg border px-3 py-2 text-xs sm:flex sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-text-muted shrink-0 font-medium">Head:</span>
            <code title={headBranch} className="text-accent min-w-0 truncate font-mono">
              {headBranch}
            </code>
          </div>
          <ArrowRightIcon className="text-text-muted/40 hidden h-3.5 w-3.5 shrink-0 sm:block" />
          <div className="flex min-w-0 items-center gap-2 sm:shrink-0">
            <span className="text-text-muted shrink-0 font-medium">Base:</span>
            <Input
              aria-label="PR base branch"
              disabled={isPublishing}
              value={baseBranch}
              onChange={(e) => {
                setBaseBranch(e.target.value);
              }}
              className="bg-background/60 h-6 w-full px-2 font-mono text-xs sm:w-28"
              placeholder="main"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-muted min-w-0 text-xs [overflow-wrap:anywhere]">
            Committed changes against {baseBranch || 'the base branch'}.
          </p>
          <GitDraftButton
            label="Generate title & description"
            pending={draft.isGenerating}
            disabled={
              isPublishing ||
              !!gitBlockedReason ||
              workspaceBusy ||
              headBranch === baseBranch.trim() ||
              !baseBranch.trim()
            }
            onClick={() => {
              setError(null);
              void draft.generate().then((result) => {
                if (result) {
                  setTitle(result.title);
                  setBody(result.body);
                }
              });
            }}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="pr-title-input" className="text-text-main block text-xs font-medium">
            Title
          </label>
          <Input
            id="pr-title-input"
            disabled={isPublishing}
            value={title}
            onChange={(event) => {
              setError(null);
              setTitle(event.target.value);
            }}
            placeholder="Describe the change"
            className="bg-background/40 border-border/30 text-text-main h-9 w-full rounded-lg px-3 text-xs"
            autoFocus
          />
        </div>
        <GitMessageEditor
          id="pr-body-input"
          label="Description (Markdown)"
          disabled={isPublishing}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={'## Summary\nDescribe the change and how it was verified.'}
          rows={6}
        />
        {blockedReason && <GitDialogNotice tone="warning">{blockedReason}</GitDialogNotice>}
        {(error || draft.error) && <GitDialogNotice>{error || draft.error}</GitDialogNotice>}
        <p className="text-text-muted text-xs">
          This pushes to{' '}
          <span className="font-mono [overflow-wrap:anywhere]">
            {gitStatus.remoteName ?? 'the remote'}
          </span>
          . If GitHub CLI is unavailable, you will finish creating the PR in your browser.
        </p>
      </GitDialogContent>
    </Dialog>
  );
}
