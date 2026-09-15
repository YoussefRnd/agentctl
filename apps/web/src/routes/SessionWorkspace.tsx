import { useEffect, useMemo } from 'react';

import { AppShell, Sidebar } from '@/app/shell';
import { useShellStore } from '@/app/shell';
import { SessionHeader } from '@/features/sessions';
import { Workbench } from '@/features/workbench';
import { MainFeed } from '@/features/conversation';
import { useWorkbenchStore } from '@/features/workbench';

const sidebarElement = <Sidebar />;

export function SessionWorkspace() {
  const workbenchTab = useWorkbenchStore((s) => s.workbenchTab);
  const openWorkbenchTabs = useWorkbenchStore((s) => s.openWorkbenchTabs);
  const isWorkbenchOpen = useWorkbenchStore((s) => s.isWorkbenchOpen);
  const isMaximized = useWorkbenchStore((s) => s.isMaximized);
  const isMobileSidebarOpen = useShellStore((s) => s.isMobileSidebarOpen);

  const setWorkbenchTab = useWorkbenchStore((s) => s.setWorkbenchTab);
  const openWorkbenchTab = useWorkbenchStore((s) => s.openWorkbenchTab);
  const closeWorkbenchTab = useWorkbenchStore((s) => s.closeWorkbenchTab);
  const setWorkbenchOpen = useWorkbenchStore((s) => s.setWorkbenchOpen);
  const toggleWorkbench = useWorkbenchStore((s) => s.toggleWorkbench);
  const setMaximized = useWorkbenchStore((s) => s.setMaximized);
  const toggleMaximized = useWorkbenchStore((s) => s.toggleMaximized);
  const moveWorkbenchTab = useWorkbenchStore((s) => s.moveWorkbenchTab);
  const setMobileSidebarOpen = useShellStore((s) => s.setMobileSidebarOpen);

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
        openTabs={openWorkbenchTabs}
        onTabChange={setWorkbenchTab}
        onOpenTab={openWorkbenchTab}
        onCloseTab={closeWorkbenchTab}
        onMoveTab={moveWorkbenchTab}
        isMaximized={isMaximized}
        onToggleMaximize={toggleMaximized}
      />
    ),
    [
      isWorkbenchOpen,
      workbenchTab,
      openWorkbenchTabs,
      isMaximized,
      setWorkbenchTab,
      openWorkbenchTab,
      closeWorkbenchTab,
      moveWorkbenchTab,
      toggleMaximized,
    ],
  );

  return (
    <AppShell
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
    </AppShell>
  );
}
