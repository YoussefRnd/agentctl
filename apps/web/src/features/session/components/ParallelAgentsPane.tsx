import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../contexts/SessionContext';
import { apiClient, checkMergeBranch, type SidebarProject } from '@agentctl/api-client';
import { Button, GlassPanel, Badge, ConfirmationModal } from '@agentctl/ui';
import {
  GitBranch,
  GitMerge,
  ArrowRightLeft,
  RefreshCw,
  Copy,
  Check,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Bot,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { SpawnAgentModal } from './SpawnAgentModal';
import { AgentDiffModal } from './AgentDiffModal';

interface MergeStatus {
  canMerge: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
}

export function ParallelAgentsPane() {
  const navigate = useNavigate();
  const { sessionId, sessionData, mergeBranch, isMergingBranch } = useSession();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [previewAgentSession, setPreviewAgentSession] = useState<{
    id: string;
    title: string;
    branch: string;
    status: string;
    taskSlug: string;
  } | null>(null);
  const [mergeStatuses, setMergeStatuses] = useState<Record<string, MergeStatus>>({});
  const [confirmMergeSession, setConfirmMergeSession] = useState<{
    id: string;
    branch: string;
    title: string;
    hasConflicts: boolean;
    conflictingFiles: string[];
  } | null>(null);

  // Retrieve projects and sessions to identify parallel worktrees
  const {
    data: projects = [],
    isLoading,
    refetch,
  } = useQuery<SidebarProject[]>({
    queryKey: ['projects', 'lastActive', false],
    queryFn: () =>
      apiClient.fetch<SidebarProject[]>('/api/projects?sortBy=lastActive&gitOnly=false'),
  });

  const currentProjectId = sessionData?.session.projectId;
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const activeSessions = (currentProject?.sessions ?? []).filter(
    (s) => s.status !== 'merged' && s.status !== 'discarded' && s.status !== 'archived',
  );

  // Pre-check merge status for other active sessions
  useEffect(() => {
    if (!sessionId) return;
    const others = activeSessions.filter((s) => s.id !== sessionId);

    others.forEach((s) => {
      if (!s.branch) return;
      void checkMergeBranch(sessionId, s.branch)
        .then((res: MergeStatus) => {
          setMergeStatuses((prev) => ({
            ...prev,
            [s.id]: res,
          }));
        })
        .catch(() => {
          // ignore
        });
    });
  }, [sessionId, activeSessions]);

  const handleSwitchSession = (targetSessionId: string) => {
    void navigate(`/sessions/${targetSessionId}`);
    toast.success('Switched workspace');
  };

  const handleCopyPath = (path: string, id: string) => {
    void navigator.clipboard.writeText(path);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
    toast.success('Worktree path copied');
  };

  const onConfirmMerge = async () => {
    if (!confirmMergeSession) return;
    const { branch } = confirmMergeSession;
    setConfirmMergeSession(null);

    void toast.promise(mergeBranch(branch), {
      loading: `Merging branch ${branch}...`,
      success: 'Successfully merged branch into current workspace',
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        return `Merge failed: ${msg}`;
      },
    });
  };

  if (isLoading) {
    return (
      <div className="text-text-muted flex h-full flex-col items-center justify-center gap-2 p-5 select-none">
        <RefreshCw className="text-accent h-4 w-4 animate-spin" />
        <span className="text-xs">Loading workspaces...</span>
      </div>
    );
  }

  return (
    <div className="bg-background/50 flex h-full min-h-0 flex-col overflow-hidden">
      {/* Clean Top Bar */}
      <header className="border-border/20 bg-surface/30 flex h-11 shrink-0 items-center justify-between border-b px-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Bot className="text-accent h-4 w-4" />
          <span className="text-text-main text-xs font-semibold">Parallel Agents</span>
          <Badge variant="default" size="sm" className="text-[10px] tabular-nums">
            {activeSessions.length} active
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="solid"
            size="sm"
            onClick={() => setIsSpawnModalOpen(true)}
            className="flex h-7 items-center gap-1.5 px-2.5 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Spawn Agent</span>
          </Button>

          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="text-text-muted hover:text-text-main hover:bg-surface-secondary/40 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            title="Refresh Worktrees"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Worktrees list */}
      <div className="flex-1 [scrollbar-width:thin] space-y-2.5 overflow-y-auto p-4">
        {activeSessions.map((s) => {
          const isCurrent = s.id === sessionId;
          const mergeStatus = mergeStatuses[s.id];

          return (
            <GlassPanel
              key={s.id}
              className={`rounded-xl border p-3.5 transition-all duration-200 ${
                isCurrent
                  ? 'border-accent/40 bg-accent/5 shadow-sm'
                  : 'border-border/20 bg-surface/30 hover:border-border/40 hover:bg-surface/50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Left info column */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    {/* Status indicator pulse */}
                    <div
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        s.status === 'running'
                          ? 'bg-accent animate-pulse'
                          : s.status === 'needs_attention'
                            ? 'bg-warning animate-ping'
                            : 'bg-text-muted/40'
                      }`}
                    />

                    <span className="text-text-main truncate text-xs font-semibold">{s.title}</span>

                    {isCurrent && (
                      <span className="bg-accent/15 text-accent py-0.2 rounded px-1.5 text-[9px] font-bold tracking-wider uppercase select-none">
                        Active
                      </span>
                    )}
                  </div>

                  {/* Branch, path and merge status row */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-text-muted/70 bg-surface-secondary/60 border-border/20 flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]">
                      <GitBranch className="h-2.5 w-2.5 opacity-60" />
                      {s.branch || 'main'}
                    </span>

                    {s.worktreePath && (
                      <button
                        type="button"
                        onClick={() => handleCopyPath(s.worktreePath || '', s.id)}
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

                {/* Right Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setPreviewAgentSession({
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
                        onClick={() => handleSwitchSession(s.id)}
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
                          const status = mergeStatuses[s.id];
                          setConfirmMergeSession({
                            id: s.id,
                            branch: s.branch || 'main',
                            title: s.title,
                            hasConflicts: status?.hasConflicts ?? false,
                            conflictingFiles: status?.conflictingFiles ?? [],
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
        })}

        {activeSessions.length <= 1 && (
          <div className="border-border/20 bg-surface/10 flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed p-8 text-center select-none">
            <Bot className="text-accent/60 h-8 w-8" />
            <div className="space-y-1">
              <h4 className="text-text-main text-xs font-semibold">No Parallel Agents Running</h4>
              <p className="text-text-muted/60 max-w-xs text-[11px] leading-relaxed">
                Dispatch background subagents to work concurrently on isolated Git branches without
                interrupting your active workspace.
              </p>
            </div>
            <Button
              variant="solid"
              size="sm"
              onClick={() => setIsSpawnModalOpen(true)}
              className="mt-1 flex items-center gap-1.5 text-xs font-semibold"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Spawn Background Agent</span>
            </Button>
          </div>
        )}
      </div>

      {/* Clean In-App Merge Confirmation Modal */}
      {confirmMergeSession && (
        <ConfirmationModal
          isOpen={confirmMergeSession !== null}
          onCancel={() => setConfirmMergeSession(null)}
          onConfirm={onConfirmMerge}
          title={
            confirmMergeSession.hasConflicts
              ? 'Merge Conflicts Detected'
              : 'Merge Workspace Branch?'
          }
          type={confirmMergeSession.hasConflicts ? 'warning' : 'accent'}
          confirmText={confirmMergeSession.hasConflicts ? 'Merge Anyway' : 'Merge Branch'}
          message={
            confirmMergeSession.hasConflicts
              ? `Merging branch "${confirmMergeSession.branch}" may conflict in ${confirmMergeSession.conflictingFiles.join(
                  ', ',
                )}. Do you want to proceed?`
              : `Merge changes from "${confirmMergeSession.title}" (${confirmMergeSession.branch}) directly into your current active workspace?`
          }
        />
      )}

      {/* Agent Diff Preview Modal */}
      <AgentDiffModal
        isOpen={previewAgentSession !== null}
        onClose={() => setPreviewAgentSession(null)}
        agentSession={previewAgentSession}
        mergeStatus={previewAgentSession ? mergeStatuses[previewAgentSession.id] : undefined}
        onMerge={(session) => {
          setConfirmMergeSession(session);
        }}
        onSwitch={handleSwitchSession}
      />

      {/* Spawn Modal */}
      <SpawnAgentModal
        isOpen={isSpawnModalOpen}
        onClose={() => setIsSpawnModalOpen(false)}
        onSuccess={() => {
          void refetch();
        }}
      />
    </div>
  );
}

export const WorktreesPane = ParallelAgentsPane;
