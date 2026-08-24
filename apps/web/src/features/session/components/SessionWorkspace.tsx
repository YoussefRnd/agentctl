import { useEffect, useMemo } from 'react';

import { Shell } from '../../shell/components/Shell';
import { Sidebar } from '../../shell/components/Sidebar';
import { SessionHeader } from './SessionHeader';
import { Workbench } from './Workbench';
import { MainFeed } from './MainFeed';
import { useUIStore } from '@/shared';

const sidebarElement = <Sidebar />;

export function SessionWorkspace() {
  const workbenchTab = useUIStore((s) => s.workbenchTab);
  const isWorkbenchOpen = useUIStore((s) => s.isWorkbenchOpen);
  const isMaximized = useUIStore((s) => s.isMaximized);
  const isMobileSidebarOpen = useUIStore((s) => s.isMobileSidebarOpen);

  const setWorkbenchTab = useUIStore((s) => s.setWorkbenchTab);
  const setWorkbenchOpen = useUIStore((s) => s.setWorkbenchOpen);
  const toggleWorkbench = useUIStore((s) => s.toggleWorkbench);
  const setMaximized = useUIStore((s) => s.setMaximized);
  const toggleMaximized = useUIStore((s) => s.toggleMaximized);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMaximized) {
        e.preventDefault();
        setMaximized(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleWorkbench();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMaximized, setMaximized, toggleWorkbench]);

  const headerElement = useMemo(
    () => (
      <SessionHeader
        onOpenMobileSidebar={() => {
          setMobileSidebarOpen(true);
        }}
        onToggleWorkbench={toggleWorkbench}
        isWorkbenchOpen={isWorkbenchOpen}
        onSelectWorkbenchTab={setWorkbenchTab}
      />
    ),
    [isWorkbenchOpen, setMobileSidebarOpen, toggleWorkbench, setWorkbenchTab],
  );

  const workbenchElement = useMemo(
    () => (
      <Workbench
        isOpen={isWorkbenchOpen}
        tab={workbenchTab}
        onTabChange={setWorkbenchTab}
        isMaximized={isMaximized}
        onToggleMaximize={toggleMaximized}
      />
    ),
    [isWorkbenchOpen, workbenchTab, isMaximized, setWorkbenchTab, toggleMaximized],
  );

  return (
    <Shell
      nav={headerElement}
      sidebar={sidebarElement}
      aside={workbenchElement}
      isAsideOpen={isWorkbenchOpen}
      isAsideMaximized={isMaximized}
      onCloseAside={() => {
        setWorkbenchOpen(false);
        setMaximized(false);
      }}
      onExpandAside={() => {
        setWorkbenchOpen(true);
      }}
      isMobileSidebarOpen={isMobileSidebarOpen}
      onCloseMobileSidebar={() => {
        setMobileSidebarOpen(false);
      }}
    >
      <MainFeed />
    </Shell>
  );
}
