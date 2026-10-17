import { useRef, useCallback, Fragment, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Plus, Columns2, Rows2, PanelRight } from 'lucide-react';
import { Dropdown, Tooltip } from '@agentctl/ui';
import { useSession } from '@/features/sessions';
import { useSettings } from '@/features/settings';
import { TerminalPane, type TerminalPaneHandle } from './TerminalPane';
import { TerminalTabsSidebar } from './TerminalTabsSidebar';
import {
  createInitialTerminalWorkspace,
  useTerminalTabsStore,
  type TerminalTabData,
} from '../../model/useTerminalTabsStore';

export interface InteractiveTerminalHandle {
  split: () => void;
  toggleOrientation: () => void;
  restart: () => void;
  clear: () => void;
  reconnect: () => void;
}

export interface TerminalMeta {
  status: 'connecting' | 'connected' | 'disconnected';
  shell: string;
  isSplit: boolean;
  splitOrientation: 'horizontal' | 'vertical';
  splitCount: number;
}

export interface InteractiveTerminalProps {
  tabId?: string;
  onMetaChange?: (meta: TerminalMeta) => void;
}

export const InteractiveTerminal = forwardRef<InteractiveTerminalHandle, InteractiveTerminalProps>(
  function InteractiveTerminal({ onMetaChange }, ref) {
    const { sessionId } = useSession();
    const { settings } = useSettings();
    const codeFont = settings?.fontConfig?.code;

    const resolvedSessionId = sessionId ?? 'pending';
    const storedWorkspace = useTerminalTabsStore((s) => s.workspaces[resolvedSessionId]);
    const ensureWorkspace = useTerminalTabsStore((s) => s.ensureWorkspace);
    const addTab = useTerminalTabsStore((s) => s.addTab);
    const setActiveTab = useTerminalTabsStore((s) => s.setActiveTab);
    const splitTab = useTerminalTabsStore((s) => s.splitTab);
    const closePane = useTerminalTabsStore((s) => s.closePane);
    const setActivePane = useTerminalTabsStore((s) => s.setActivePane);
    const setPaneShell = useTerminalTabsStore((s) => s.setPaneShell);
    const setPaneStatus = useTerminalTabsStore((s) => s.setPaneStatus);
    const toggleSplitOrientation = useTerminalTabsStore((s) => s.toggleSplitOrientation);
    const toggleSidebar = useTerminalTabsStore((s) => s.toggleSidebar);

    useEffect(() => {
      if (sessionId) ensureWorkspace(sessionId);
    }, [ensureWorkspace, sessionId]);

    const workspace = storedWorkspace ?? createInitialTerminalWorkspace(resolvedSessionId);
    const { tabs, activeTabId, isSidebarOpen } = workspace;

    // Get current active tab
    const activeTab: TerminalTabData = tabs.find((t) => t.id === activeTabId) ??
      tabs[0] ?? {
        id: 'tab-1',
        name: 'Terminal 1',
        panes: [{ id: 'term-1', name: 'Terminal 1', shell: 'sh', status: 'connecting' }],
        activePaneId: 'term-1',
        splitOrientation: 'horizontal',
      };

    const isSplit = activeTab.panes.length > 1;
    const activePane =
      activeTab.panes.find((p) => p.id === activeTab.activePaneId) ?? activeTab.panes[0];

    const paneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map());

    const registerPaneRef = useCallback((paneId: string, handle: TerminalPaneHandle | null) => {
      if (handle) {
        paneRefs.current.set(paneId, handle);
      } else {
        paneRefs.current.delete(paneId);
      }
    }, []);

    const handleRestart = useCallback(() => {
      if (activePane?.id) {
        paneRefs.current.get(activePane.id)?.restart();
      }
    }, [activePane?.id]);

    const handleClear = useCallback(() => {
      if (activePane?.id) {
        paneRefs.current.get(activePane.id)?.clear();
      }
    }, [activePane?.id]);

    const handleReconnect = useCallback(() => {
      if (activePane?.id) {
        paneRefs.current.get(activePane.id)?.restart();
      }
    }, [activePane?.id]);

    const handleSplit = useCallback(() => {
      const container = document.querySelector('[data-font-ctx="terminal"]');
      const width = container?.clientWidth ?? 800;
      const height = container?.clientHeight ?? 600;
      // If container is narrow (<640px) or taller than wide, vertical split (top/bottom) gives full column width
      const preferredOrientation = width < 640 || height > width * 1.1 ? 'vertical' : 'horizontal';
      splitTab(
        resolvedSessionId,
        activeTab.id,
        activeTab.panes.length === 1 ? preferredOrientation : undefined,
      );
    }, [splitTab, resolvedSessionId, activeTab.id, activeTab.panes.length]);

    const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
      () => () => {
        if (layoutTimer.current) clearTimeout(layoutTimer.current);
      },
      [resolvedSessionId],
    );
    const handleToggleOrientation = useCallback(() => {
      toggleSplitOrientation(resolvedSessionId, activeTab.id);
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      layoutTimer.current = setTimeout(() => {
        layoutTimer.current = null;
        activeTab.panes.forEach((p) => {
          paneRefs.current.get(p.id)?.fit();
        });
      }, 60);
    }, [toggleSplitOrientation, resolvedSessionId, activeTab]);

    // Expose actions to imperative handle
    useImperativeHandle(
      ref,
      () => ({
        split: handleSplit,
        toggleOrientation: handleToggleOrientation,
        restart: handleRestart,
        clear: handleClear,
        reconnect: handleReconnect,
      }),
      [handleSplit, handleToggleOrientation, handleRestart, handleClear, handleReconnect],
    );

    // Notify parent if meta changes
    useEffect(() => {
      onMetaChange?.({
        status: activePane?.status ?? 'connecting',
        shell: activePane?.shell ?? 'sh',
        isSplit,
        splitOrientation: activeTab.splitOrientation,
        splitCount: activeTab.panes.length,
      });
    }, [
      activePane?.status,
      activePane?.shell,
      isSplit,
      activeTab.splitOrientation,
      activeTab.panes.length,
      onMetaChange,
    ]);

    // Refit all panes on window resize
    useEffect(() => {
      const onResize = () => {
        activeTab.panes.forEach((p) => {
          paneRefs.current.get(p.id)?.fit();
        });
      };
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
      };
    }, [activeTab.panes]);

    const handleFocusPane = useCallback(
      (pId: string) => {
        setActivePane(resolvedSessionId, activeTab.id, pId);
      },
      [activeTab.id, resolvedSessionId, setActivePane],
    );

    const handleClosePane = useCallback(
      (pId: string) => {
        closePane(resolvedSessionId, activeTab.id, pId);
      },
      [activeTab.id, closePane, resolvedSessionId],
    );

    const handleShellChange = useCallback(
      (pId: string, shell: string) => {
        setPaneShell(resolvedSessionId, pId, shell);
      },
      [resolvedSessionId, setPaneShell],
    );

    const handleStatusChange = useCallback(
      (pId: string, st: 'connecting' | 'connected' | 'disconnected') => {
        setPaneStatus(resolvedSessionId, pId, st);
      },
      [resolvedSessionId, setPaneStatus],
    );

    return (
      <div
        data-font-ctx="terminal"
        className="@container/terminal relative flex h-full min-w-0 flex-1 overflow-hidden bg-[#11111b]"
      >
        {/* Main Terminal Canvas Stage */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#11111b]">
          {/* Narrow panes keep the canvas usable and expose tabs through a menu. */}
          <div
            className={`border-border/30 bg-surface/85 absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-md border p-0.5 opacity-60 shadow-md backdrop-blur-md transition-opacity focus-within:opacity-100 hover:opacity-100 ${isSidebarOpen ? '@[360px]/terminal:hidden' : ''}`}
          >
            <Tooltip content="New Terminal">
              <button
                type="button"
                onClick={() => addTab(resolvedSessionId)}
                className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
                aria-label="New terminal"
              >
                <Plus className="icon-inline" />
              </button>
            </Tooltip>

            <Tooltip content="Split Terminal">
              <button
                type="button"
                onClick={handleSplit}
                className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
                aria-label="Split terminal"
              >
                <Columns2 className="icon-inline" />
              </button>
            </Tooltip>

            {isSplit && (
              <Tooltip
                content={`Switch to ${activeTab.splitOrientation === 'horizontal' ? 'Vertical (Top/Bottom)' : 'Horizontal (Side-by-side)'} Split`}
              >
                <button
                  type="button"
                  onClick={handleToggleOrientation}
                  className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
                  aria-label="Toggle split orientation"
                >
                  {activeTab.splitOrientation === 'horizontal' ? (
                    <Rows2 className="icon-inline" />
                  ) : (
                    <Columns2 className="icon-inline" />
                  )}
                </button>
              </Tooltip>
            )}

            <div className="bg-border/40 mx-0.5 h-3 w-px" />

            <div className="@[360px]/terminal:hidden">
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Choose terminal"
                    className="text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5.5 w-5.5 items-center justify-center rounded"
                  >
                    <PanelRight className="icon-inline" />
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content align="end">
                    {tabs.map((terminal) => (
                      <Dropdown.Item
                        key={terminal.id}
                        onSelect={() => setActiveTab(resolvedSessionId, terminal.id)}
                      >
                        <span className="max-w-48 truncate">{terminal.name}</span>
                        {terminal.id === activeTab.id && (
                          <span className="text-text-muted ml-2">Current</span>
                        )}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
            <div className="hidden @[360px]/terminal:block">
              <Tooltip content={isSidebarOpen ? 'Hide Terminal Tabs' : 'Show Terminal Tabs'}>
                <button
                  type="button"
                  onClick={() => toggleSidebar(resolvedSessionId)}
                  className="motion-disclosure text-text-muted hover:text-text-main hover:bg-surface-secondary flex h-5.5 w-5.5 items-center justify-center rounded transition-colors"
                  aria-label={isSidebarOpen ? 'Hide terminal tabs' : 'Show terminal tabs'}
                >
                  <PanelRight className="icon-inline" />
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Terminal Panes - Always rendered within Group/Panel to preserve terminal lifecycle on split */}
          <Group orientation={activeTab.splitOrientation} className="h-full w-full">
            {activeTab.panes.map((pane, index) => (
              <Fragment key={pane.id}>
                {index > 0 && (
                  <Separator
                    className={`bg-border/25 hover:bg-border/60 active:bg-border/80 relative flex shrink-0 items-center justify-center transition-colors ${
                      activeTab.splitOrientation === 'horizontal'
                        ? 'w-px cursor-col-resize hover:w-0.5'
                        : 'h-px cursor-row-resize hover:h-0.5'
                    }`}
                  />
                )}
                <Panel
                  id={pane.id}
                  minSize="15%"
                  defaultSize={Math.floor(100 / activeTab.panes.length)}
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <TerminalPane
                    key={pane.id}
                    ref={(handle) => registerPaneRef(pane.id, handle)}
                    id={pane.id}
                    name={pane.name}
                    sessionId={sessionId ?? ''}
                    isActive={(activeTab.activePaneId || activeTab.panes[0]?.id) === pane.id}
                    isSplit={isSplit}
                    splitOrientation={activeTab.splitOrientation}
                    codeFont={codeFont}
                    onFocus={handleFocusPane}
                    onClose={handleClosePane}
                    onToggleOrientation={handleToggleOrientation}
                    onShellChange={handleShellChange}
                    onStatusChange={handleStatusChange}
                  />
                </Panel>
              </Fragment>
            ))}
          </Group>
        </div>

        {/* VS Code-Style Terminal Tabs Sidebar (Right side) */}
        {isSidebarOpen && <TerminalTabsSidebar sessionId={resolvedSessionId} />}
      </div>
    );
  },
);
