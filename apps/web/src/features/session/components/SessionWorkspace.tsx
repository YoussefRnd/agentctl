import { useEffect, useState, useMemo } from 'react';

import { Shell } from '../../shell/components/Shell';
import { Sidebar } from '../../shell/components/Sidebar';
import { SessionHeader } from './SessionHeader';
import { Workbench, type WorkbenchTab } from './Workbench';
import { MainFeed } from './MainFeed';

const sidebarElement = <Sidebar />;

export function SessionWorkspace() {
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('status');
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMaximized) {
        e.preventDefault();
        setIsMaximized(false);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setIsWorkbenchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMaximized]);

  const headerElement = useMemo(
    () => (
      <SessionHeader
        onOpenMobileSidebar={() => {
          setIsMobileSidebarOpen(true);
        }}
        onToggleWorkbench={() => {
          setIsWorkbenchOpen((prev) => !prev);
        }}
        isWorkbenchOpen={isWorkbenchOpen}
      />
    ),
    [isWorkbenchOpen],
  );

  const workbenchElement = useMemo(
    () => (
      <Workbench
        isOpen={isWorkbenchOpen}
        tab={workbenchTab}
        onTabChange={setWorkbenchTab}
        isMaximized={isMaximized}
        onToggleMaximize={() => {
          setIsMaximized((prev) => !prev);
        }}
      />
    ),
    [isWorkbenchOpen, workbenchTab, isMaximized],
  );

  return (
    <Shell
      nav={headerElement}
      sidebar={sidebarElement}
      aside={workbenchElement}
      isAsideOpen={isWorkbenchOpen}
      isAsideMaximized={isMaximized}
      onCloseAside={() => {
        setIsWorkbenchOpen(false);
        setIsMaximized(false);
      }}
      onExpandAside={() => {
        setIsWorkbenchOpen(true);
      }}
      isMobileSidebarOpen={isMobileSidebarOpen}
      onCloseMobileSidebar={() => {
        setIsMobileSidebarOpen(false);
      }}
    >
      <MainFeed />
    </Shell>
  );
}
