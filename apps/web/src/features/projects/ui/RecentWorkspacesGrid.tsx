import { Folder, FolderPlus, Clock, ChevronRight } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import type { SessionMode } from '@agentctl/shared';
import { GlassPanel } from '@agentctl/ui';

function formatRelativeTime(dateInput?: string | Date | null): string {
  if (!dateInput) return 'No recent activity';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return 'No recent activity';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return 'Just now';

  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'Just now';

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${String(diffMins)}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${String(diffDays)}d ago`;

  const diffMonths = Math.floor(diffDays / 30);
  return `${String(diffMonths)}mo ago`;
}

function getLastActiveTimestamp(project: SidebarProject): string {
  if (project.sessions.length === 0) return 'No recent activity';
  let latest = 0;
  for (const s of project.sessions) {
    const time = new Date(s.lastActivityAt).getTime();
    if (!isNaN(time) && time > latest) {
      latest = time;
    }
  }
  return latest > 0 ? formatRelativeTime(new Date(latest)) : 'No recent activity';
}

function getActiveSessionCount(project: SidebarProject): number {
  return project.sessions.filter((s) => s.status !== 'archived' && s.status !== 'discarded').length;
}

interface RecentWorkspacesGridProps {
  projects: SidebarProject[];
  selectedMode: SessionMode;
  onOpenDirectory: () => void;
  onSelectProject: (path: string, mode: SessionMode) => void;
}

export function RecentWorkspacesGrid({
  projects,
  selectedMode,
  onOpenDirectory,
  onSelectProject,
}: RecentWorkspacesGridProps) {
  if (projects.length === 0) return null;

  return (
    <div className="w-full space-y-3 pt-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
          Recent Workspaces
        </h2>
        <button
          type="button"
          onClick={onOpenDirectory}
          className="text-text-muted hover:text-accent flex cursor-pointer items-center gap-1 text-xs font-medium transition-colors"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span>Open directory</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((proj, index) => {
          const activeCount = getActiveSessionCount(proj);
          const lastActive = getLastActiveTimestamp(proj);

          return (
            <GlassPanel
              key={proj.id}
              style={{
                animationDelay: `${Math.min(index, 6) * 40}ms`,
                animationDuration: '150ms',
              }}
              className="group border-border/40 hover:border-accent/40 bg-surface-secondary/20 hover:bg-surface-secondary/40 animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-backwards flex cursor-pointer flex-col justify-between rounded-xl p-4 transition-[background-color,border-color] duration-200 ease-out"
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectProject(proj.path, selectedMode);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectProject(proj.path, selectedMode);
                  }
                }}
                className="focus-visible:ring-accent/40 flex flex-col space-y-2.5 rounded-lg outline-none focus-visible:ring-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="bg-surface-secondary/60 text-accent shrink-0 rounded-lg p-2">
                      <Folder className="h-4 w-4" />
                    </div>
                    <span className="text-text-main group-hover:text-accent truncate text-[14px] font-semibold transition-colors">
                      {proj.name}
                    </span>
                  </div>
                  <ChevronRight className="text-text-muted group-hover:text-accent h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>

                <p className="text-text-muted/70 truncate font-mono text-[11px]">{proj.path}</p>
              </div>

              <div className="border-border/20 text-text-muted mt-4 flex items-center justify-between border-t pt-3 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      activeCount > 0 ? 'bg-emerald-500' : 'bg-surface-tertiary'
                    }`}
                  />
                  {activeCount} {activeCount === 1 ? 'active session' : 'active sessions'}
                </span>
                <span className="flex items-center gap-1 opacity-80">
                  <Clock className="h-3 w-3" />
                  {lastActive}
                </span>
              </div>
            </GlassPanel>
          );
        })}
      </div>
    </div>
  );
}
