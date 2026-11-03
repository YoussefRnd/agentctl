import { useState, useEffect, useRef, useMemo, useId, type ElementType } from 'react';
import { Dialog, DialogContent, DialogTitle, SearchHighlight, cn, Spinner } from '@agentctl/ui';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fuzzySearch, getSessionDisplayTitle } from '@agentctl/shared';
import {
  Search,
  Folder,
  MessageSquare,
  Settings,
  Cpu,
  Layers,
  Sun,
  Moon,
  Monitor,
  PanelRight,
  Maximize2,
  Plus,
  CornerDownLeft,
  X,
  FolderGit2,
} from 'lucide-react';
import { useSettingsOverlayStore } from '@/features/settings';
import { useWorkbenchStore } from '@/shared/stores/useWorkbenchStore';
import { projectQueries } from '@/features/projects';
import { useCommandPaletteStore } from '../model/useCommandPaletteStore';
import { useTheme } from '@/shared';

interface PaletteItem {
  id: string;
  category: 'Sessions' | 'Workspaces' | 'Actions';
  title: string;
  subtitle?: string;
  icon: ElementType;
  badge?: string;
  badgeType?: 'running' | 'needs_attention' | 'error' | 'default';
  onSelect: () => void;
}

const categories = ['Sessions', 'Workspaces', 'Actions'] as const;
type PaletteFilter = 'All' | PaletteItem['category'];

export function CommandPalette() {
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const closePalette = useCommandPaletteStore((s) => s.close);
  const openSettings = useSettingsOverlayStore((s) => s.openSettings);
  const toggleWorkbench = useWorkbenchStore((s) => s.toggleWorkbench);
  const toggleMaximized = useWorkbenchStore((s) => s.toggleMaximized);

  const { themeMode, setThemeMode } = useTheme();
  const navigate = useNavigate();

  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PaletteFilter>('All');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const {
    data: projects = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    ...projectQueries.all(),
    enabled: isOpen,
  });

  // Reset the search when palette opens.
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setFilter('All');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Build searchable items list
  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // 1. Sessions across all workspaces
    for (const proj of projects) {
      for (const s of proj.sessions) {
        const sessionTitle = getSessionDisplayTitle(s);
        const badgeType =
          s.status === 'running'
            ? 'running'
            : s.status === 'needs_attention'
              ? 'needs_attention'
              : s.status === 'error'
                ? 'error'
                : undefined;

        list.push({
          id: `session-${s.id}`,
          category: 'Sessions',
          title: sessionTitle,
          subtitle: `${proj.name}${s.branch ? ` • ${s.branch}` : ''}`,
          icon: MessageSquare,
          badge:
            s.status === 'running'
              ? 'Running'
              : s.status === 'needs_attention'
                ? 'Needs review'
                : s.status === 'error'
                  ? 'Error'
                  : undefined,
          badgeType,
          onSelect: () => {
            closePalette();
            void navigate(`/sessions/${s.id}`);
          },
        });
      }
    }

    // 2. Workspaces
    for (const proj of projects) {
      const isGit = proj.isGitRepo;
      list.push({
        id: `project-${proj.id}`,
        category: 'Workspaces',
        title: proj.name,
        subtitle: `${proj.sessions.length} session${proj.sessions.length === 1 ? '' : 's'} • ${proj.path}`,
        icon: isGit ? FolderGit2 : Folder,
        onSelect: () => {
          closePalette();
          if (proj.sessions.length > 0 && proj.sessions[0]) {
            void navigate(`/sessions/${proj.sessions[0].id}`);
          } else {
            void navigate(`/?project=${encodeURIComponent(proj.id)}`);
          }
        },
      });
    }

    // 3. Actions & Commands
    list.push(
      {
        id: 'action-new-workspace',
        category: 'Actions',
        title: 'Open / Add Workspace',
        subtitle: 'Select a project folder from disk',
        icon: Plus,
        onSelect: () => {
          closePalette();
          void navigate('/');
        },
      },
      {
        id: 'action-settings-general',
        category: 'Actions',
        title: 'Settings: General',
        subtitle: 'Configure theme, fonts, and defaults',
        icon: Settings,
        onSelect: () => {
          closePalette();
          openSettings('general');
        },
      },
      {
        id: 'action-settings-providers',
        category: 'Actions',
        title: 'Settings: Agent Providers',
        subtitle: 'Configure installed and available agent providers',
        icon: Cpu,
        onSelect: () => {
          closePalette();
          openSettings('providers');
        },
      },
      {
        id: 'action-settings-mcp',
        category: 'Actions',
        title: 'Settings: MCP Tools',
        subtitle: 'Manage Model Context Protocol servers',
        icon: Layers,
        onSelect: () => {
          closePalette();
          openSettings('mcp');
        },
      },
      {
        id: 'action-theme-toggle',
        category: 'Actions',
        title: `Theme: Switch to ${themeMode === 'dark' ? 'Light' : 'Dark'}`,
        subtitle: `Currently using ${themeMode} mode`,
        icon: themeMode === 'dark' ? Sun : Moon,
        onSelect: () => {
          closePalette();
          setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
        },
      },
      {
        id: 'action-theme-system',
        category: 'Actions',
        title: 'Theme: Follow System Appearance',
        subtitle: 'Automatically sync with OS theme',
        icon: Monitor,
        onSelect: () => {
          closePalette();
          setThemeMode('system');
        },
      },
      {
        id: 'action-toggle-workbench',
        category: 'Actions',
        title: 'Toggle Workbench Panel',
        subtitle: 'Show / hide diffs, terminal, and status view',
        icon: PanelRight,
        onSelect: () => {
          closePalette();
          toggleWorkbench();
        },
      },
      {
        id: 'action-toggle-maximize',
        category: 'Actions',
        title: 'Toggle Fullscreen / Maximize Chat',
        subtitle: 'Expand workspace canvas',
        icon: Maximize2,
        onSelect: () => {
          closePalette();
          toggleMaximized();
        },
      },
    );

    return list;
  }, [
    projects,
    closePalette,
    navigate,
    openSettings,
    themeMode,
    setThemeMode,
    toggleWorkbench,
    toggleMaximized,
  ]);

  const searchQuery = query.trim();
  const filteredItems = useMemo(() => {
    const candidates = filter === 'All' ? items : items.filter((item) => item.category === filter);
    return fuzzySearch(candidates, searchQuery, (item) => [
      item.title,
      item.subtitle,
      item.category,
    ]);
  }, [items, searchQuery, filter]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));
  const indexedItems = filteredItems.map((item, index) => ({ item, index }));
  // Preserve global fuzzy ranking while searching. Browsing uses category groups;
  // the DOM order and keyboard order always refer to the same indexed list.
  const groups = searchQuery
    ? [{ label: 'Best matches', items: indexedItems }]
    : categories.map((category) => ({
        label: category,
        items: indexedItems.filter(({ item }) => item.category === category),
      }));

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    // Let filter buttons handle their own Enter and Space keys.
    if (event.target !== inputRef.current || filteredItems.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((activeIndex + step + filteredItems.length) % filteredItems.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      filteredItems[activeIndex]?.onSelect();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex, filteredItems]);

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closePalette();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="border-border/50 bg-brand-mantle flex max-h-[min(38rem,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl border p-0 shadow-2xl"
        onEscapeKeyDown={(event) => {
          if (event.isComposing) event.preventDefault();
        }}
        onKeyDown={handleKeyDown}
        onOpenAutoFocus={(event) => {
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previousFocusRef.current?.focus();
        }}
      >
        <div className="border-border/30 shrink-0 border-b px-4 pt-4 pb-3">
          <div className="mb-3 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="bg-accent/15 text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            >
              <Search className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-text-main text-xs font-semibold">
                Command Palette
              </DialogTitle>
              <p className="text-text-muted mt-0.5 text-[11px]">
                Jump to a session, workspace, or action
              </p>
            </div>
          </div>
          <div className="border-border/40 bg-surface-secondary/50 focus-within:border-accent/50 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors">
            <Search aria-hidden="true" className="text-text-muted h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search commands"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls={listboxId}
              aria-activedescendant={
                filteredItems[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search sessions, workspaces, and actions…"
              autoComplete="off"
              spellCheck={false}
              className="text-text-main placeholder:text-text-muted/60 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              onClick={closePalette}
              aria-label="Close command palette"
              className="text-text-muted hover:bg-accent/10 hover:text-text-main focus-visible:ring-accent flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter search results"
          className="flex shrink-0 flex-wrap items-center gap-1 px-3 pt-2.5 pb-2"
        >
          {(['All', ...categories] as const).map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={filter === category}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFilter(category);
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className={cn(
                'focus-visible:ring-accent cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                filter === category
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:bg-surface-secondary hover:text-text-main',
              )}
            >
              {category}
            </button>
          ))}
        </div>

        {isPending && (
          <div
            role="status"
            className="text-text-muted flex shrink-0 items-center gap-2 px-4 pb-2 text-[11px]"
          >
            <Spinner aria-hidden="true" className="icon-compact" />
            Loading sessions and workspaces…
          </div>
        )}
        {isError && (
          <div
            role="status"
            className="text-text-muted flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-2 text-[11px]"
          >
            <span>Couldn’t load sessions and workspaces. Actions are still available.</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-accent focus-visible:ring-accent cursor-pointer rounded px-1 py-0.5 focus-visible:ring-2 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          aria-busy={isPending}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <div
                  key={group.label}
                  role="group"
                  aria-label={group.label}
                  className="pb-2 last:pb-0"
                >
                  <div
                    aria-hidden="true"
                    className="text-text-muted px-2.5 py-2 text-[10px] font-semibold tracking-wider uppercase"
                  >
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map(({ item, index }) => {
                      const selected = index === activeIndex;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          id={`${listboxId}-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}${item.badge ? `, ${item.badge}` : ''}`}
                          tabIndex={-1}
                          data-index={index}
                          data-item-id={item.id}
                          title={`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => {
                            if (!selected) setSelectedIndex(index);
                          }}
                          onClick={item.onSelect}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors',
                            selected
                              ? 'bg-accent/10 text-text-main'
                              : 'text-text-muted hover:bg-surface-secondary',
                          )}
                        >
                          <div
                            aria-hidden="true"
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                              selected
                                ? 'bg-accent/15 text-accent'
                                : 'bg-surface-secondary/70 text-text-muted',
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-text-main truncate text-xs font-medium">
                              <SearchHighlight text={item.title} query={searchQuery} />
                            </p>
                            {item.subtitle && (
                              <p className="text-text-muted mt-1 truncate text-[11px]">
                                <SearchHighlight text={item.subtitle} query={searchQuery} />
                              </p>
                            )}
                            {item.badge && (
                              <span
                                className={cn(
                                  'mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
                                  item.badgeType === 'running'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : item.badgeType === 'needs_attention'
                                      ? 'bg-amber-500/10 text-amber-400'
                                      : 'text-danger bg-danger/10',
                                )}
                              >
                                {item.badgeType === 'running' && (
                                  <span
                                    aria-hidden="true"
                                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                                  />
                                )}
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {searchQuery && filter === 'All' && (
                              <span className="text-text-muted bg-surface-secondary/70 hidden rounded-md px-1.5 py-1 text-[10px] sm:inline">
                                <SearchHighlight text={item.category} query={searchQuery} />
                              </span>
                            )}
                            {selected && (
                              <CornerDownLeft
                                aria-hidden="true"
                                className="text-accent h-3.5 w-3.5"
                              />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ),
          )}
        </div>

        {filteredItems.length === 0 && !isPending && (
          <div
            role="status"
            className="text-text-muted flex flex-col items-center gap-2 px-4 pt-3 pb-8 text-center text-xs"
          >
            <Search aria-hidden="true" className="h-5 w-5" />
            <p>
              {searchQuery ? (
                <>No matches for “{searchQuery}”</>
              ) : (
                `No ${filter.toLowerCase()} available.`
              )}
            </p>
            <p className="text-[11px]">Try a shorter name, a workspace path, or another filter.</p>
          </div>
        )}

        <div className="border-border/30 text-text-muted flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px]">
          <span role="status">
            {filteredItems.length} {filteredItems.length === 1 ? 'result' : 'results'}
          </span>
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono">↵</kbd> open
            </span>
            <span>
              <kbd className="font-mono">Esc</kbd> close
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
