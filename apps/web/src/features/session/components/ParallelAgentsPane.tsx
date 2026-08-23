import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../contexts/SessionContext';
import { apiClient, checkMergeBranch, type SidebarProject } from '@agentctl/api-client';
import { Button, ConfirmationModal } from '@agentctl/ui';
import { RefreshCw, Plus, Sparkles, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { SpawnAgentModal } from './SpawnAgentModal';
import { AgentDiffModal } from './AgentDiffModal';
import { AgentSessionCard, type MergeStatus } from './AgentSessionCard';

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
        <RefreshCw className="text-accent h-5 w-5 animate-spin" />
        <span className="text-xs font-medium">Scanning background worktrees...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 select-none">
      {/* Header with Spawn button */}
      <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-text-main text-xs font-bold tracking-wider uppercase">
              Parallel Workspaces
            </h3>
            <span className="border-border/30 bg-surface-secondary/40 text-text-muted py-0.2 rounded border px-1.5 font-mono text-[10px]">
              {activeSessions.length} active
            </span>
          </div>
          <p className="text-text-muted/60 text-[11px]">
            Concurrent worktree branches executing in isolation
          </p>
        </div>

        <Button
          variant="solid"
          size="sm"
          onClick={() => setIsSpawnModalOpen(true)}
          className="flex h-7 items-center gap-1.5 px-2.5 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Agent</span>
        </Button>
      </div>

      {/* List of active worktrees / sessions */}
      <div className="space-y-2.5">
        {activeSessions.map((s) => {
          const isCurrent = s.id === sessionId;
          const mergeStatus = mergeStatuses[s.id];

          return (
            <AgentSessionCard
              key={s.id}
              session={s}
              isCurrent={isCurrent}
              copiedId={copiedId}
              mergeStatus={mergeStatus}
              isMergingBranch={isMergingBranch}
              onCopyPath={handleCopyPath}
              onPreviewDiff={(agent) => setPreviewAgentSession(agent)}
              onSwitchSession={handleSwitchSession}
              onInitiateMerge={(cfg) => setConfirmMergeSession(cfg)}
            />
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
