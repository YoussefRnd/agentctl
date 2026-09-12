import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
  ArrowRight,
  FolderGit2,
} from 'lucide-react';
import { apiClient, type SidebarProject } from '@agentctl/api-client';
import { useUIStore } from '@/shared';
import { useTheme } from '../../../contexts/ThemeProvider';

interface PaletteItem {
  id: string;
  category: 'Sessions' | 'Workspaces' | 'Actions';
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  badge?: string;
  badgeType?: 'running' | 'needs_attention' | 'error' | 'default';
  onSelect: () => void;
}

export function CommandPalette() {
  const isOpen = useUIStore((s) => s.isCommandPaletteOpen);
  const closePalette = useUIStore((s) => s.closeCommandPalette);
  const openSettings = useUIStore((s) => s.openSettings);
  const toggleWorkbench = useUIStore((s) => s.toggleWorkbench);
  const toggleMaximized = useUIStore((s) => s.toggleMaximized);

  const { themeMode, setThemeMode } = useTheme();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: projects = [] } = useQuery<SidebarProject[]>({
    queryKey: ['projects'],
    queryFn: () => apiClient.fetch<SidebarProject[]>('/api/projects'),
    enabled: isOpen,
  });

  // Focus search input when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Build searchable items list
  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // 1. Sessions across all workspaces
    for (const proj of projects) {
      for (const s of proj.sessions) {
        const sessionTitle = s.title || s.taskSlug || s.branch || 'Untitled session';
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
                ? 'Review Needed'
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
      const isGit = proj.sessions.some((s) => s.mode === 'worktree');
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
            void navigate('/');
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

  // Filter items based on query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    return items.filter((item) => {
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchSubtitle = item.subtitle?.toLowerCase().includes(q) ?? false;
      const matchCategory = item.category.toLowerCase().includes(q);
      return matchTitle || matchSubtitle || matchCategory;
    });
  }, [items, query]);

  // Reset selected index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }

    if (filteredItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) {
        current.onSelect();
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Group filtered items by category
  const categories: Array<'Sessions' | 'Workspaces' | 'Actions'> = [
    'Sessions',
    'Workspaces',
    'Actions',
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="z-popover fixed inset-0 flex items-start justify-center bg-black/60 p-4 pt-[14vh] backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div
        className="border-border/60 bg-surface-elevated/95 liquid-glass flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="border-border/40 bg-surface/50 flex items-center gap-3 border-b px-4 py-3">
          <Search className="text-text-muted h-4 w-4 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search sessions, workspaces..."
            className="text-text-main placeholder:text-text-muted/50 flex-1 bg-transparent text-sm font-medium outline-none"
          />
          <kbd className="border-border/40 bg-surface-secondary/60 text-text-muted rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="divide-border/10 max-h-[55vh] divide-y overflow-y-auto p-2">
          {filteredItems.length === 0 ? (
            <div className="text-text-muted py-10 text-center text-xs">
              No matching commands or sessions found
            </div>
          ) : (
            categories.map((cat) => {
              const catItems = filteredItems.filter((i) => i.category === cat);
              if (catItems.length === 0) return null;

              return (
                <div key={cat} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="text-text-muted/70 px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase">
                    {cat}
                  </div>
                  <div className="space-y-0.5">
                    {catItems.map((item) => {
                      const itemIndex = filteredItems.findIndex((i) => i.id === item.id);
                      const isSelected = itemIndex === selectedIndex;
                      const Icon = item.icon;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-index={itemIndex}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          onClick={item.onSelect}
                          className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'bg-accent/15 text-text-main shadow-xs'
                              : 'text-text-muted hover:text-text-main hover:bg-surface/50'
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <div
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                                isSelected
                                  ? 'bg-accent/20 text-accent'
                                  : 'bg-surface-secondary text-text-muted'
                              }`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`truncate text-xs font-semibold ${isSelected ? 'text-text-main' : ''}`}
                                >
                                  {item.title}
                                </span>
                                {item.badge && (
                                  <span
                                    className={`py-0.2 inline-flex items-center gap-1 rounded-full px-1.5 font-mono text-[9px] font-bold ${
                                      item.badgeType === 'running'
                                        ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                                        : item.badgeType === 'needs_attention'
                                          ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
                                          : 'bg-surface-secondary text-text-muted'
                                    }`}
                                  >
                                    {item.badgeType === 'running' && (
                                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                    )}
                                    {item.badge}
                                  </span>
                                )}
                              </div>
                              {item.subtitle && (
                                <p className="text-text-muted/60 truncate font-mono text-[10px]">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {isSelected ? <ArrowRight className="text-accent h-3.5 w-3.5" /> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div className="border-border/30 bg-surface/30 text-text-muted/70 flex items-center justify-between border-t px-3.5 py-2 text-[10.5px]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 font-medium">
              <kbd className="border-border/40 bg-surface-secondary/70 rounded px-1 font-mono text-[9px]">
                ↑
              </kbd>
              <kbd className="border-border/40 bg-surface-secondary/70 rounded px-1 font-mono text-[9px]">
                ↓
              </kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1 font-medium">
              <kbd className="border-border/40 bg-surface-secondary/70 rounded px-1 font-mono text-[9px]">
                ↵
              </kbd>
              <span>select</span>
            </span>
          </div>
          <span className="font-mono text-[9.5px]">agentctl palette</span>
        </div>
      </div>
    </div>
  );
}
