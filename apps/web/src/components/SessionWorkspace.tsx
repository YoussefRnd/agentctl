import { useEffect, useState } from 'react';

import { Sidebar } from './Sidebar';
import { useSession } from '../contexts/SessionContext';
import { SessionHeader } from './SessionHeader';
import { Workbench, type WorkbenchTab } from './Workbench';
import { MainFeed } from './MainFeed';
import { SessionLayout } from './SessionLayout';

export function SessionWorkspace() {
  const { sessionId } = useSession();

  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('status');
  const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Toggle with Cmd/Ctrl + \
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setIsWorkbenchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <SessionLayout
      isMobileSidebarOpen={isMobileSidebarOpen}
      onCloseMobileSidebar={() => {
        setIsMobileSidebarOpen(false);
      }}
      isWorkbenchOpen={isWorkbenchOpen}
      onCloseWorkbench={() => {
        setIsWorkbenchOpen(false);
      }}
      sidebar={<Sidebar />}
      header={
        <SessionHeader
          sessionId={sessionId}
          onOpenMobileSidebar={() => {
            setIsMobileSidebarOpen(true);
          }}
          isWorkbenchOpen={isWorkbenchOpen}
          onToggleWorkbench={() => {
            setIsWorkbenchOpen((prev) => !prev);
          }}
        />
      }
      workbench={
        <Workbench
          isOpen={isWorkbenchOpen}
          tab={workbenchTab}
          onTabChange={setWorkbenchTab}
        />
      }
    >
      <MainFeed
        isWorkbenchOpen={isWorkbenchOpen}
        workbenchTab={workbenchTab}
        onOpenWorkbench={(tab) => {
          setIsWorkbenchOpen(true);
          setWorkbenchTab(tab);
        }}
      />
    </SessionLayout>
  );
}
