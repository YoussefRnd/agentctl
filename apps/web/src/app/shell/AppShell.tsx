import { type ReactNode, useEffect, useCallback, useState } from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  useDefaultLayout,
  type PanelSize,
} from 'react-resizable-panels';
import { GlassPanel } from '@agentctl/ui';
import { TitleBar } from './TitleBar';
import { UpdateToast } from './UpdateToast';

interface ShellProps {
  children: ReactNode;
  nav: ReactNode;
  sidebar?: ReactNode;
  aside?: ReactNode;
  isAsideOpen?: boolean;
  isAsideMaximized?: boolean;
  onCloseAside?: () => void;
  onExpandAside?: () => void;
  isMobileSidebarOpen?: boolean;
  onOpenMobileSidebar?: () => void;
  onCloseMobileSidebar?: () => void;
}

export function AppShell({
  children,
  nav,
  sidebar,
  aside,
  isAsideOpen = true,
  isAsideMaximized = false,
  onCloseAside,
  onExpandAside,
  isMobileSidebarOpen,
  onOpenMobileSidebar,
  onCloseMobileSidebar,
}: ShellProps) {
  const sidebarPanelRef = usePanelRef();
  const asidePanelRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'shell-layout',
    storage: localStorage,
  });

  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches,
  );
  const [uncontrolledMobileSidebarOpen, setUncontrolledMobileSidebarOpen] = useState(false);
  const mobileSidebarOpen = isMobileSidebarOpen ?? uncontrolledMobileSidebarOpen;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const handleAsideResize = useCallback(
    (size: PanelSize, _id: string | number | undefined, previousSize: PanelSize | undefined) => {
      if (previousSize === undefined) return;
      if (size.asPercentage < 1) {
        onCloseAside?.();
      } else {
        onExpandAside?.();
      }
    },
    [onCloseAside, onExpandAside],
  );

  const handleToggleDesktopSidebar = useCallback(() => {
    const panel = sidebarPanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  }, [sidebarPanelRef]);

  const handleCloseMobileSidebar = useCallback(() => {
    onCloseMobileSidebar?.();
    setUncontrolledMobileSidebarOpen(false);
  }, [onCloseMobileSidebar]);

  const handleToggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) {
      if (mobileSidebarOpen) {
        handleCloseMobileSidebar();
      } else if (onOpenMobileSidebar) {
        onOpenMobileSidebar();
      } else {
        setUncontrolledMobileSidebarOpen(true);
      }
      return;
    }
    handleToggleDesktopSidebar();
  }, [
    handleCloseMobileSidebar,
    handleToggleDesktopSidebar,
    mobileSidebarOpen,
    onOpenMobileSidebar,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleToggleSidebar]);

  useEffect(() => {
    const panel = asidePanelRef.current;
    if (!panel) return;
    if (isAsideOpen && panel.isCollapsed()) {
      panel.expand();
    } else if (!isAsideOpen && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [isAsideOpen, isDesktop, asidePanelRef]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCloseMobileSidebar();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [handleCloseMobileSidebar, mobileSidebarOpen]);

  return (
    <div className="bg-background text-text-main relative flex h-screen w-full flex-col overflow-hidden">
      <TitleBar nav={nav} onToggleSidebar={sidebar ? handleToggleSidebar : undefined} />

      <div className="relative z-10 min-h-0 w-full flex-1 overflow-hidden p-2 sm:p-3">
        {(isAsideMaximized || (!isDesktop && isAsideOpen)) && aside ? (
          <div className="bg-background border-border/20 absolute inset-3 z-30 flex flex-col overflow-hidden rounded-lg border shadow-2xl backdrop-blur-xl">
            {aside}
          </div>
        ) : (
          <Group
            key={isDesktop ? 'desktop' : 'mobile'}
            defaultLayout={isDesktop ? defaultLayout : undefined}
            onLayoutChanged={isDesktop ? onLayoutChanged : undefined}
          >
            {sidebar && isDesktop && (
              <Panel
                id="sidebar"
                panelRef={sidebarPanelRef}
                defaultSize="17%"
                minSize="10%"
                maxSize="25%"
                collapsible
                collapsedSize="0%"
                className="hidden lg:block"
              >
                <GlassPanel
                  className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
                  intensity="high"
                >
                  {sidebar}
                </GlassPanel>
              </Panel>
            )}

            {sidebar && isDesktop && (
              <Separator className="group after:bg-border/35 hover:after:bg-accent/60 data-[resize-handle-active]:after:bg-accent hidden w-3 shrink-0 cursor-col-resize items-center justify-center after:h-8 after:w-px after:rounded-full after:transition-[height,background-color] after:duration-150 hover:after:h-12 data-[resize-handle-active]:after:h-12 lg:flex" />
            )}

            <Panel id="main" minSize="30%">
              <main className="relative flex h-full min-w-0 flex-col overflow-hidden">
                <GlassPanel
                  className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
                  intensity="high"
                >
                  <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {children}
                  </div>
                </GlassPanel>
              </main>
            </Panel>

            {aside && isDesktop && (
              <>
                <Separator className="group after:bg-border/35 hover:after:bg-accent/60 data-[resize-handle-active]:after:bg-accent flex w-3 shrink-0 cursor-col-resize items-center justify-center after:h-8 after:w-px after:rounded-full after:transition-[height,background-color] after:duration-150 hover:after:h-12 data-[resize-handle-active]:after:h-12" />
                <Panel
                  id="aside"
                  panelRef={asidePanelRef}
                  defaultSize="30%"
                  minSize="15%"
                  maxSize="50%"
                  collapsible
                  collapsedSize="0%"
                  onResize={handleAsideResize}
                >
                  <div
                    className="h-full min-h-0 min-w-0"
                    inert={!isAsideOpen}
                    aria-hidden={!isAsideOpen}
                  >
                    {aside}
                  </div>
                </Panel>
              </>
            )}
          </Group>
        )}

        {sidebar && (
          <>
            <aside
              className={`bg-background/95 border-border fixed inset-y-0 left-0 z-50 w-[min(320px,calc(100vw-48px))] border-r shadow-2xl backdrop-blur-2xl transition-transform duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] lg:hidden ${
                mobileSidebarOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
              }`}
              aria-hidden={!mobileSidebarOpen}
              inert={!mobileSidebarOpen}
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest('a[href]')) {
                  handleCloseMobileSidebar();
                }
              }}
            >
              <div className="flex h-full flex-col">{sidebar}</div>
            </aside>

            {mobileSidebarOpen && (
              <button
                type="button"
                aria-label="Close sidebar"
                className="animate-in fade-in-0 fixed inset-0 z-40 border-none bg-black/60 backdrop-blur-md duration-200 ease-out outline-none lg:hidden"
                onClick={handleCloseMobileSidebar}
              />
            )}
          </>
        )}
      </div>

      <UpdateToast />
    </div>
  );
}
