import type { ReactNode } from 'react';

interface SessionLayoutProps {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
  workbench: ReactNode;
  isMobileSidebarOpen: boolean;
  onCloseMobileSidebar: () => void;
  isWorkbenchOpen: boolean;
  onCloseWorkbench: () => void;
}

export function SessionLayout({
  sidebar,
  header,
  children,
  workbench,
  isMobileSidebarOpen,
  onCloseMobileSidebar,
  isWorkbenchOpen,
  onCloseWorkbench,
}: SessionLayoutProps) {
  return (
    <div className="flex h-full w-full overflow-hidden relative">
      <div className="hidden lg:block w-[260px] shrink-0 border-r border-border/50 z-20 bg-background">
        {sidebar}
      </div>

      <aside
        className={`fixed inset-y-0 left-0 w-[280px] bg-background z-50 border-r border-border transition-transform duration-300 ease-in-out lg:hidden ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">{sidebar}</div>
      </aside>

      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onCloseMobileSidebar}
        />
      )}

      <main className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden relative">
        {header}
        {children}
      </main>

      {workbench}

      {isWorkbenchOpen && (
        <div
          className="absolute inset-0 bg-background/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={onCloseWorkbench}
        />
      )}
    </div>
  );
}
