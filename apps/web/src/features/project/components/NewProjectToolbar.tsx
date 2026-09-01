import { Folder, FolderPlus, Bot, ArrowUp, ChevronDown, Check } from 'lucide-react';
import type { SidebarProject } from '@agentctl/api-client';
import type { SessionMode, ProviderDiscovery } from '@agentctl/shared';
import { Dropdown, Tooltip, Button } from '@agentctl/ui';
import { GitBranchIcon } from '@primer/octicons-react';

interface NewProjectToolbarProps {
  projects: SidebarProject[];
  activeProject: SidebarProject | undefined;
  setSelectedProjectId: (id: string) => void;
  setShowExplorer: (show: boolean) => void;
  installedProviders: ProviderDiscovery[];
  activeProvider: { id: string; label?: string };
  setSelectedProviderId: (id: string) => void;
  selectedMode: SessionMode;
  setSelectedMode: (mode: SessionMode) => void;
  handleLaunch: () => void;
}

export function NewProjectToolbar({
  projects,
  activeProject,
  setSelectedProjectId,
  setShowExplorer,
  installedProviders,
  activeProvider,
  setSelectedProviderId,
  selectedMode,
  setSelectedMode,
  handleLaunch,
}: NewProjectToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Workspace Selector Chip */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
            >
              <Folder className="text-accent h-3 w-3 shrink-0" />
              <span className="max-w-[150px] truncate">
                {activeProject?.name ?? 'Select workspace'}
              </span>
              <ChevronDown className="h-2.5 w-2.5 opacity-50" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="start" className="max-h-[300px] w-64 overflow-y-auto">
              <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                Workspaces
              </div>
              {projects.map((proj) => {
                const isSelected = proj.id === activeProject?.id;
                return (
                  <Dropdown.Item
                    key={proj.id}
                    className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors"
                    onSelect={() => {
                      setSelectedProjectId(proj.id);
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isSelected ? (
                        <Check className="text-accent h-3 w-3 shrink-0" />
                      ) : (
                        <div className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate font-medium">{proj.name}</span>
                    </div>
                  </Dropdown.Item>
                );
              })}
              <div className="bg-border/30 my-1 h-px" />
              <Dropdown.Item
                className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                onSelect={() => {
                  setShowExplorer(true);
                }}
              >
                <FolderPlus className="h-3.5 w-3.5 opacity-70" />
                <span>Open another directory...</span>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>

        {/* Agent Provider Chip */}
        {installedProviders.length > 0 && (
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button
                type="button"
                className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
              >
                <Bot className="text-text-muted h-3 w-3 shrink-0" />
                <span className="max-w-[140px] truncate">
                  {activeProvider.label || activeProvider.id}
                </span>
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="start" className="w-56">
                <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                  AI Agent
                </div>
                {installedProviders.map((provider) => {
                  const isSelected = provider.id === activeProvider.id;
                  return (
                    <Dropdown.Item
                      key={provider.id}
                      className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
                      onSelect={() => {
                        setSelectedProviderId(provider.id);
                      }}
                    >
                      {isSelected ? (
                        <Check className="text-accent h-3 w-3 shrink-0" />
                      ) : (
                        <div className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate font-medium">{provider.label || provider.id}</span>
                    </Dropdown.Item>
                  );
                })}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        )}

        {/* Mode Selector Pill */}
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className="bg-surface-secondary/60 hover:bg-surface-secondary text-text-muted hover:text-text-main border-border/40 hover:border-border/70 flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors"
            >
              <GitBranchIcon className="h-3 w-3 opacity-60" />
              <span className="capitalize">{selectedMode}</span>
              <ChevronDown className="h-2 w-2 opacity-50" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="start" className="w-40">
              {(['worktree', 'local'] as SessionMode[]).map((mode) => (
                <Dropdown.Item
                  key={mode}
                  className="hover:bg-surface-secondary text-text-main flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs capitalize transition-colors"
                  onSelect={() => {
                    setSelectedMode(mode);
                  }}
                >
                  {selectedMode === mode ? (
                    <Check className="text-accent h-3 w-3 shrink-0" />
                  ) : (
                    <div className="h-3 w-3 shrink-0" />
                  )}
                  <span>{mode}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>

      {/* Primary Submit Action */}
      <Tooltip content="Start session (Enter)">
        <Button
          size="sm"
          className="bg-accent text-brand-crust flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-none p-0 shadow-[0_0_20px_rgba(203,166,247,0.25)] transition-colors duration-300 hover:opacity-90"
          onClick={handleLaunch}
          aria-label="Start session"
        >
          <ArrowUp className="h-4 w-4 stroke-[3]" />
        </Button>
      </Tooltip>
    </div>
  );
}
