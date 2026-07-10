import { type ReactNode, useRef, useEffect, useCallback } from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  useDefaultLayout,
  type PanelSize,
} from 'react-resizable-panels';
import { GlassPanel } from '@agentctl/ui';
import { ProgressBar } from './ProgressBar';
import { TitleBar } from './TitleBar';

interface ShellProps {
  children: ReactNode;
  nav: ReactNode;
  sidebar?: ReactNode;
  aside?: ReactNode;
  isAsideOpen?: boolean;
  onCloseAside?: () => void;
  onExpandAside?: () => void;
  isMobileSidebarOpen?: boolean;
  onCloseMobileSidebar?: () => void;
}

export function Shell({
  children,
  nav,
  sidebar,
  aside,
  isAsideOpen = true,
  onCloseAside,
  onExpandAside,
  isMobileSidebarOpen = false,
  onCloseMobileSidebar,
}: ShellProps) {
  const asidePanelRef = usePanelRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'shell-layout',
    storage: localStorage,
  });

  const isInitialResize = useRef(true);

  const handleAsideResize = useCallback(
    (size: PanelSize) => {
      if (isInitialResize.current) {
        isInitialResize.current = false;
        return;
      }
      if (size.asPercentage < 1) {
        onCloseAside?.();
      } else {
        onExpandAside?.();
      }
    },
    [onCloseAside, onExpandAside],
  );

  useEffect(() => {
    const panel = asidePanelRef.current;
    if (!panel) return;
    if (isAsideOpen && panel.isCollapsed()) {
      panel.expand();
    } else if (!isAsideOpen && !panel.isCollapsed()) {
      panel.collapse();
    }
  }, [isAsideOpen, asidePanelRef]);

  return (
    <div className="bg-background text-text-main relative flex h-screen w-full flex-col overflow-hidden">
      <ProgressBar />

      <TitleBar nav={nav} />

      <div className="relative z-10 min-h-0 w-full flex-1 overflow-hidden p-3">
        <Group defaultLayout={defaultLayout} onLayoutChanged={onLayoutChanged}>
          {sidebar && (
            <Panel
              id="sidebar"
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

          {sidebar && (
            <Separator className="hidden w-3 shrink-0 cursor-col-resize lg:block" />
          )}

          <Panel id="main" minSize="30%">
            <main className="relative flex h-full min-w-0 flex-col overflow-hidden">
              <GlassPanel
                className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
                intensity="high"
              >
                <div className="relative flex flex-1 flex-col overflow-hidden">
                  {children}
                </div>
              </GlassPanel>
            </main>
          </Panel>

          {aside && (
            <>
              <Separator className="w-3 shrink-0 cursor-col-resize" />
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
                {aside}
              </Panel>
            </>
          )}
        </Group>

        {sidebar && onCloseMobileSidebar && (
          <>
            <aside
              className={`bg-background/95 border-border fixed inset-y-0 left-0 z-50 w-[300px] border-r backdrop-blur-2xl transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden ${
                isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <div className="flex h-full flex-col p-4">{sidebar}</div>
            </aside>

            {isMobileSidebarOpen && (
              <button
                type="button"
                aria-label="Close sidebar"
                className="fixed inset-0 z-40 border-none bg-black/60 backdrop-blur-md transition-opacity duration-500 outline-none lg:hidden"
                onClick={onCloseMobileSidebar}
              />
            )}
          </>
        )}
      </div>

      {aside && onCloseAside && isAsideOpen && (
        <button
          type="button"
          aria-label="Close aside panel"
          className="pointer-events-auto fixed inset-0 z-20 border-none bg-black/10 outline-none lg:hidden"
          onClick={onCloseAside}
        />
      )}
    </div>
  );
}
