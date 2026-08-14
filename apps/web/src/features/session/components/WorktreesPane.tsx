import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../contexts/SessionContext';
import { apiClient, type SidebarProject } from '@agentctl/api-client';
import { Button, GlassPanel } from '@agentctl/ui';
import {
  GitBranch,
  GitMerge,
  ArrowRightLeft,
  RefreshCw,
  AlertCircle,
  Home,
  FolderGit,
  Copy,
  Check,
  HelpCircle,
  X,
  Code,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function WorktreesPane() {
  const navigate = useNavigate();
  const { sessionId, sessionData, mergeBranch, isMergingBranch } = useSession();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

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

  const handleSwitchSession = (targetSessionId: string) => {
    void navigate(`/sessions/${targetSessionId}`);
    toast.success('Switched to workspace');
  };

  const handleMergeSession = (branchName: string, title: string) => {
    if (
      confirm(
        `Are you sure you want to merge workspace "${title}" (${branchName}) into your current active workspace?`,
      )
    ) {
      void toast.promise(mergeBranch(branchName), {
        loading: `Merging branch ${branchName}...`,
        success: 'Successfully merged branch into current workspace',
        error: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          return `Merge failed: ${msg}`;
        },
      });
    }
  };

  const handleCopyPath = (path: string, id: string) => {
    void navigator.clipboard.writeText(path);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
    toast.success('Workspace path copied to clipboard');
  };

  if (isLoading) {
    return (
      <div className="text-text-muted flex h-full flex-col items-center justify-center gap-2 p-5 select-none">
        <RefreshCw className="text-accent h-5 w-5 animate-spin" />
        <span className="label-2xs opacity-45">Loading worktrees...</span>
      </div>
    );
  }

  return (
    <div className="bg-surface-secondary/5 flex h-full min-h-0 flex-col">
      {/* Pane Header */}
      <div className="border-border/10 bg-surface-secondary/15 flex shrink-0 items-center justify-between border-b px-5 py-3">
        <div>
          <h2 className="text-text-main text-[11px] font-black tracking-[0.2em] uppercase">
            Worktree Isolation
          </h2>
          <p className="text-text-muted text-[8.5px] font-bold tracking-tight uppercase opacity-65">
            Parallel Workspace Directories
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setShowExplanation(!showExplanation);
            }}
            className={`cursor-pointer rounded p-1 transition-all ${
              showExplanation
                ? 'text-accent bg-accent/10'
                : 'text-text-muted/50 hover:text-text-main hover:bg-surface-secondary/40'
            }`}
            title="How Worktrees Work"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="text-text-muted/50 hover:text-text-main hover:bg-surface-secondary/40 cursor-pointer rounded p-1 transition-all"
            title="Refresh Worktrees"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Explanation Banner */}
      {showExplanation && (
        <div className="border-border/10 bg-accent/5 animate-fadeIn relative shrink-0 border-b p-4">
          <button
            type="button"
            onClick={() => {
              setShowExplanation(false);
            }}
            className="text-text-muted/40 hover:text-text-main absolute top-3 right-3 cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
          <h3 className="text-accent mb-1.5 flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase">
            <Code className="h-3 w-3" />
            Parallel Workspaces Guide
          </h3>
          <p className="text-text-muted text-[9.5px] leading-relaxed opacity-90">
            Worktrees checkout your code into <strong>isolated physical directories</strong>. This
            lets you run agents concurrently on different branches without file conflicts or
            stashing code.
          </p>
          <ul className="text-text-muted/80 mt-2 space-y-1 text-[9px]">
            <li className="flex items-center gap-1.5">
              <span className="bg-accent h-1 w-1 rounded-full" />
              <strong>Switch</strong>: Jump immediately to another active session.
            </li>
            <li className="flex items-center gap-1.5">
              <span className="bg-accent h-1 w-1 rounded-full" />
              <strong>Merge</strong>: Pull that session&apos;s branch into your current workspace.
            </li>
          </ul>
        </div>
      )}

      {/* Worktrees list */}
      <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
        {activeSessions.map((s) => {
          const isCurrent = s.id === sessionId;
          const isWorktree = s.mode === 'worktree';
          const isBaseBranch = s.branch === 'main' || s.branch === 'master' || s.branch === 'dev';

          const statusColors: Record<string, string> = {
            running: 'border-accent bg-accent/5 text-accent',
            needs_attention: 'border-warning bg-warning/5 text-warning',
            idle: 'border-border/30 bg-surface-secondary/20 text-text-muted',
            error: 'border-danger bg-danger/5 text-danger',
          };

          return (
            <GlassPanel
              key={s.id}
              className={`rounded-xl border p-4 transition-all duration-300 hover:scale-[1.01] ${
                isCurrent
                  ? 'border-accent/40 bg-accent/5 shadow-[0_4px_24px_rgba(203,166,247,0.06)]'
                  : 'border-border/15 hover:border-border/30 bg-surface/20'
              }`}
            >
              <div className="space-y-3">
                {/* Header Row */}
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text-main truncate text-xs font-black">{s.title}</span>
                      {isCurrent && (
                        <span className="bg-accent/15 text-accent border-accent/25 animate-pulse rounded border px-1.5 py-0.5 text-[7.5px] font-black tracking-widest uppercase select-none">
                          Current
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[7px] font-black tracking-wider uppercase ${
                          statusColors[s.status] ?? 'border-border/30 text-text-muted'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-text-muted/65 flex items-center gap-1 truncate font-mono text-[9.5px] font-bold tracking-wider uppercase">
                        <GitBranch className="text-text-muted/30 h-3 w-3 shrink-0" />
                        {s.branch}
                      </p>
                      <span className="bg-surface/50 text-text-muted/40 border-border/5 rounded border px-1 font-mono text-[7px] font-extrabold uppercase">
                        {isBaseBranch ? 'base' : 'feature'}
                      </span>
                    </div>
                  </div>

                  {/* Actions Column */}
                  {!isCurrent && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          handleSwitchSession(s.id);
                        }}
                        className="border-border/30 hover:border-accent/30 hover:bg-surface-secondary/40 flex h-7 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[9px] font-black tracking-wider uppercase transition-all duration-200 active:scale-[0.98]"
                      >
                        <ArrowRightLeft className="h-3 w-3" />
                        Switch
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isMergingBranch}
                        onClick={() => {
                          handleMergeSession(s.branch, s.title);
                        }}
                        className="bg-accent/10 hover:bg-accent/20 text-accent/90 flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-transparent px-2.5 text-[9px] font-black tracking-wider uppercase transition-all duration-200 active:scale-[0.98] disabled:opacity-40"
                      >
                        <GitMerge className="h-3 w-3" />
                        Merge
                      </Button>
                    </div>
                  )}
                </div>

                {/* Path & Type Details Panel */}
                <div className="bg-surface/30 border-border/10 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[9.5px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {isWorktree ? (
                      <FolderGit className="text-accent h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Home className="text-text-muted/50 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="text-text-muted truncate font-bold">
                      {isWorktree ? 'Worktree Directory' : 'Main Directory'}
                    </span>
                  </div>
                  {s.worktreePath && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPath(s.worktreePath || '', s.id);
                      }}
                      className="hover:text-accent text-text-muted/40 flex shrink-0 cursor-pointer items-center gap-1 font-mono text-[9px] transition-colors"
                      title="Copy workspace path"
                    >
                      {copiedId === s.id ? (
                        <Check className="h-2.5 w-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                      <span>{s.worktreePath.split('/').pop()}</span>
                    </button>
                  )}
                </div>
              </div>
            </GlassPanel>
          );
        })}

        {activeSessions.length <= 1 && (
          <div className="border-border/20 bg-surface/10 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center select-none">
            <AlertCircle className="text-text-muted/30 h-6 w-6" />
            <div>
              <h4 className="text-text-muted/60 label-2xs">No Parallel Workspaces</h4>
              <p className="text-text-muted/40 mt-1 max-w-[240px] text-[9.5px] leading-relaxed">
                Create another session for this project to start parallel workspace development.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
