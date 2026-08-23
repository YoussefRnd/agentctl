import {
  GitBranch,
  GitMerge,
  ArrowRightLeft,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { Button, GlassPanel, Badge } from '@agentctl/ui';
import type { SidebarProject } from '@agentctl/api-client';

export interface MergeStatus {
  canMerge: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
}

interface AgentSessionCardProps {
  session: SidebarProject['sessions'][number];
  isCurrent: boolean;
  copiedId: string | null;
  mergeStatus?: MergeStatus;
  isMergingBranch: boolean;
  onCopyPath: (path: string, id: string) => void;
  onPreviewDiff: (session: {
    id: string;
    title: string;
    branch: string;
    status: string;
    taskSlug: string;
  }) => void;
  onSwitchSession: (id: string) => void;
  onInitiateMerge: (session: {
    id: string;
    branch: string;
    title: string;
    hasConflicts: boolean;
    conflictingFiles: string[];
  }) => void;
}

export function AgentSessionCard({
  session: s,
  isCurrent,
  copiedId,
  mergeStatus,
  isMergingBranch,
  onCopyPath,
  onPreviewDiff,
  onSwitchSession,
  onInitiateMerge,
}: AgentSessionCardProps) {
  return (
    <GlassPanel
      key={s.id}
      intensity={isCurrent ? 'high' : 'default'}
      className={`border-border/30 rounded-xl p-3.5 transition-colors ${
        isCurrent ? 'border-accent/40 bg-accent/5' : 'bg-surface/30'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <h4 className="text-text-main truncate text-xs font-semibold">
              {s.title || 'Untitled Session'}
            </h4>
            {isCurrent ? (
              <Badge variant="accent" size="sm">
                Active
              </Badge>
            ) : (
              <Badge
                variant={s.status === 'running' ? 'accent' : 'outline'}
                size="sm"
                className="capitalize"
              >
                {s.status}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-text-muted/70 bg-surface-secondary/60 border-border/20 flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]">
              <GitBranch className="h-2.5 w-2.5 opacity-60" />
              {s.branch || 'main'}
            </span>

            {s.worktreePath && (
              <button
                type="button"
                onClick={() => onCopyPath(s.worktreePath || '', s.id)}
                className="text-text-muted/50 hover:text-text-main flex items-center gap-1 font-mono text-[10px] transition-colors"
                title="Copy worktree path"
              >
                {copiedId === s.id ? (
                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                ) : (
                  <Copy className="h-2.5 w-2.5" />
                )}
                <span>{s.worktreePath.split('/').pop()}</span>
              </button>
            )}

            {!isCurrent && mergeStatus && (
              <span
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  mergeStatus.hasConflicts
                    ? 'bg-warning/15 text-warning border-warning/30 border'
                    : 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                }`}
              >
                {mergeStatus.hasConflicts ? (
                  <>
                    <AlertTriangle className="h-2.5 w-2.5" />
                    <span>Conflicts ({mergeStatus.conflictingFiles.length})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    <span>Ready to Merge</span>
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onPreviewDiff({
                id: s.id,
                title: s.title,
                branch: s.branch || 'main',
                status: s.status,
                taskSlug: s.taskSlug,
              })
            }
            className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 h-7 gap-1 px-2 text-[11px] font-medium"
            title="Preview modified files and diffs"
          >
            <Eye className="h-3 w-3" />
            <span>Diff</span>
          </Button>

          {!isCurrent && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSwitchSession(s.id)}
                className="h-7 gap-1 px-2 text-[11px] font-medium"
                title="Switch to this workspace"
              >
                <ArrowRightLeft className="h-3 w-3" />
                <span>Switch</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                disabled={isMergingBranch}
                onClick={() => {
                  onInitiateMerge({
                    id: s.id,
                    branch: s.branch || 'main',
                    title: s.title,
                    hasConflicts: mergeStatus?.hasConflicts ?? false,
                    conflictingFiles: mergeStatus?.conflictingFiles ?? [],
                  });
                }}
                className="bg-accent/10 hover:bg-accent/20 text-accent h-7 gap-1 px-2 text-[11px] font-medium disabled:opacity-40"
                title="Merge into current workspace"
              >
                <GitMerge className="h-3 w-3" />
                <span>Merge</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
