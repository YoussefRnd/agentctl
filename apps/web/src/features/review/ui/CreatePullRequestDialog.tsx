import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Input,
  Button,
} from '@agentctl/ui';
import { GitPullRequestIcon } from '@primer/octicons-react';
import { Loader2, ArrowRight } from 'lucide-react';
import { useGitStatus } from '../model/useGitStatus';

interface CreatePullRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultTitle?: string;
  defaultBaseBranch?: string;
  currentBranch?: string;
  onSuccess?: (url: string, created: boolean) => void;
}

export function CreatePullRequestDialog({
  open,
  onOpenChange,
  sessionId,
  defaultTitle = '',
  defaultBaseBranch = 'main',
  currentBranch = 'feature-branch',
  onSuccess,
}: CreatePullRequestDialogProps) {
  const { gitStatus, createPullRequest, isCreatingPullRequest } = useGitStatus(sessionId);

  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState('');
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setBody('');
      setBaseBranch(defaultBaseBranch);
      setError(null);
    }
  }, [open, defaultTitle, defaultBaseBranch]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError('PR title is required');
      return;
    }
    if (!baseBranch.trim()) {
      setError('Base branch is required');
      return;
    }

    try {
      setError(null);
      const result = await createPullRequest({
        title: title.trim(),
        body: body.trim(),
        baseBranch: baseBranch.trim(),
      });

      if (result.status === 'needs_browser') {
        onSuccess?.(result.compareUrl, false);
      } else {
        onSuccess?.(result.pr.url, result.status === 'created');
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="p-6">
          <DialogHeader className="mb-4">
            <div className="bg-surface-accent text-accent ring-accent/30 mb-3 flex h-9 w-9 items-center justify-center rounded-xl shadow-[0_0_15px_rgba(203,166,247,0.2)] ring-1">
              <GitPullRequestIcon className="h-4.5 w-4.5" />
            </div>
            <DialogTitle className="text-text-main text-lg font-semibold">
              Create Pull Request
            </DialogTitle>
            <DialogDescription className="text-text-muted text-xs font-normal opacity-80">
              Push the committed branch and open a pull request on GitHub
            </DialogDescription>
          </DialogHeader>

          {/* Branch Target Flow */}
          <div className="bg-surface-secondary/40 border-border/20 mb-4 flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-text-muted font-medium">Head:</span>
              <code className="text-accent font-mono">{currentBranch}</code>
            </div>
            <ArrowRight className="text-text-muted/40 h-3.5 w-3.5" />
            <div className="flex items-center gap-2">
              <span className="text-text-muted font-medium">Base:</span>
              <Input
                value={baseBranch}
                onChange={(e) => {
                  setBaseBranch(e.target.value);
                }}
                className="bg-background/60 h-6 w-28 px-2 font-mono text-xs"
                placeholder="main"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center">
                <label htmlFor="pr-title-input" className="text-text-main text-xs font-medium">
                  Title
                </label>
              </div>
              <Input
                id="pr-title-input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
                placeholder="Describe the change"
                className="bg-background/40 border-border/20 text-text-main h-9 w-full rounded-lg px-3 text-xs"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="pr-body-input"
                className="text-text-main mb-1.5 block text-xs font-medium"
              >
                Description (Markdown)
              </label>
              <textarea
                id="pr-body-input"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                }}
                placeholder={'## Summary\nDescribe the change and how it was verified.'}
                rows={6}
                className="bg-background/40 border-border/20 text-text-main focus:border-accent/50 focus:ring-accent/20 w-full rounded-lg p-3 font-mono text-xs shadow-inner outline-none focus:ring-1"
              />
            </div>

            {error && (
              <p className="bg-danger/10 border-danger/20 text-danger rounded-md border p-2 text-xs">
                {error}
              </p>
            )}
            <p className="text-text-muted/70 text-xs">
              This pushes to{' '}
              <span className="font-mono">{gitStatus.remoteName ?? 'the remote'}</span>. If GitHub
              CLI is unavailable, you will finish creating the PR in your browser.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isCreatingPullRequest}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => {
                void handleCreate();
              }}
              disabled={isCreatingPullRequest || !title.trim() || !baseBranch.trim()}
              className="gap-1.5"
            >
              {isCreatingPullRequest ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Publishing PR...</span>
                </>
              ) : (
                <>
                  <GitPullRequestIcon className="h-3.5 w-3.5" />
                  <span>Push and create PR</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
