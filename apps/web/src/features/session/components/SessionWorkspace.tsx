import { useEffect, useState } from 'react';

import { Sidebar } from '../../shell/components/Sidebar';
import { useSession } from '../../../contexts/SessionContext';
import { SessionHeader } from './SessionHeader';
import { Workbench, type WorkbenchTab } from './Workbench';
import { MainFeed } from './MainFeed';
import { SessionLayout } from './SessionLayout';

export function SessionWorkspace() {
 const { sessionId } = useSession();

 const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('status');
 const [isWorkbenchOpen, setIsWorkbenchOpen] = useState(true);
 const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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
    />
   }

   workbench={
    <Workbench 
     isOpen={isWorkbenchOpen} 
     tab={workbenchTab} 
     onTabChange={setWorkbenchTab} 
     onToggle={() => { setIsWorkbenchOpen((prev) => !prev); }}

    />
   }

  >
   <MainFeed />
  </SessionLayout>
 );
}
