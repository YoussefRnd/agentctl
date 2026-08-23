import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@agentctl/api-client';
import { Button, GlassPanel, Badge } from '@agentctl/ui';
import { parseDiff } from '../../../shared/lib/diff-parser';
import { DiffBlock } from './diff/DiffBlock';
import {
  Bot,
  GitBranch,
  GitMerge,
  X,
  RefreshCw,
  AlertTriangle,
  FileCode,
  ArrowRightLeft,
} from 'lucide-react';

interface MergeStatus {
  canMerge: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
}

interface AgentDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentSession: {
    id: string;
    title: string;
    branch: string;
    status: string;
    taskSlug: string;
  } | null;
  mergeStatus?: MergeStatus;
  onMerge: (session: {
    id: string;
    branch: string;
    title: string;
    hasConflicts: boolean;
    conflictingFiles: string[];
  }) => void;
  onSwitch: (sessionId: string) => void;
}

export function AgentDiffModal({
  isOpen,
  onClose,
  agentSession,
  mergeStatus,
  onMerge,
  onSwitch,
}: AgentDiffModalProps) {
  const sessionId = agentSession?.id;

  const {
    data: reviewData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['session-review', sessionId],
    queryFn: async () => {
      if (!sessionId) return { files: [] };
      const res = await api.getSessionReview({ params: { id: sessionId } });
      if (res.status !== 200) {
        throw new Error('Failed to fetch changes for agent');
      }
      return res.body;
    },
    enabled: isOpen && !!sessionId,
  });

  const parsedFiles = useMemo(() => {
    if (!reviewData?.files) return [];
    return reviewData.files.map((file) => {
      const hunks = file.diff ? parseDiff(file.diff) : [];
      return {
        ...file,
        hunks,
      };
    });
  }, [reviewData]);

  if (!isOpen || !agentSession) return null;

  const filesCount = parsedFiles.length;
  const hasConflicts = mergeStatus?.hasConflicts ?? false;
  const conflictingFiles = mergeStatus?.conflictingFiles ?? [];

  return (
    <div className="animate-fadeIn fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <GlassPanel className="border-border/20 bg-surface/95 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <header className="border-border/10 bg-surface-secondary/20 flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="border-accent/30 bg-accent/10 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-text-main truncate text-sm font-semibold">
                  {agentSession.title || 'Parallel Agent Workspace'}
                </h2>
                <Badge variant="outline" size="sm" className="text-[10px]">
                  {agentSession.status}
                </Badge>
              </div>
              <div className="text-text-muted flex items-center gap-2 text-xs">
                <GitBranch className="h-3 w-3 opacity-60" />
                <span className="truncate font-mono text-[11px]">{agentSession.branch}</span>
                <span>•</span>
                <span>
                  {filesCount} {filesCount === 1 ? 'file changed' : 'files changed'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              title="Refresh Diffs"
              aria-label="Refresh diffs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close diff modal"
              className="text-text-muted hover:text-text-main rounded-md p-1 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 [scrollbar-width:thin] space-y-4 overflow-y-auto p-5">
          {/* Conflict Warning if any */}
          {hasConflicts && (
            <div className="border-warning/30 bg-warning/10 text-text-main flex items-start gap-3 rounded-xl border p-3.5 text-xs">
              <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Merge Conflicts Detected</p>
                <p className="text-text-muted mt-0.5 text-[11px]">
                  This agent branch has overlapping changes with your current active workspace in:{' '}
                  <span className="text-warning font-mono font-medium">
                    {conflictingFiles.join(', ')}
                  </span>
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-text-muted flex h-48 flex-col items-center justify-center gap-2">
              <RefreshCw className="text-accent h-5 w-5 animate-spin" />
              <span className="text-xs">Loading changes from workspace branch...</span>
            </div>
          ) : parsedFiles.length === 0 ? (
            <div className="text-text-muted flex h-48 flex-col items-center justify-center gap-2 text-center">
              <FileCode className="h-8 w-8 opacity-40" />
              <p className="text-sm font-medium">No modified files in this workspace branch yet</p>
              <p className="text-[11px] opacity-70">
                The background agent hasn't written any file diffs to disk.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {parsedFiles.map((file) => (
                <DiffBlock key={file.path} path={file.path} hunks={file.hunks} showHeader={true} />
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <footer className="border-border/10 bg-surface-secondary/20 flex shrink-0 items-center justify-between border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              onSwitch(agentSession.id);
            }}
            className="flex items-center gap-1.5 text-xs"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            <span>Switch to Workspace</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
              Close
            </Button>
            <Button
              type="button"
              variant="solid"
              size="sm"
              onClick={() => {
                onClose();
                onMerge({
                  id: agentSession.id,
                  branch: agentSession.branch,
                  title: agentSession.title,
                  hasConflicts,
                  conflictingFiles,
                });
              }}
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <GitMerge className="h-3.5 w-3.5" />
              <span>Merge Changes</span>
            </Button>
          </div>
        </footer>
      </GlassPanel>
    </div>
  );
}
