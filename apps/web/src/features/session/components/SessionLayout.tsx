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
    <div className="relative flex h-full w-full overflow-hidden bg-black">
      <div className="border-white/5 z-20 hidden w-[220px] shrink-0 border-r lg:block">
        {sidebar}
      </div>

      <aside
        className={`bg-black border-white/10 fixed inset-y-0 left-0 z-50 w-[240px] border-r transition-transform duration-300 ease-in-out lg:hidden ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">{sidebar}</div>
      </aside>

      {isMobileSidebarOpen && (
        <div
          className="bg-black/80 fixed inset-0 z-40 lg:hidden"
          onClick={onCloseMobileSidebar}
        />
      )}

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {header}
        {children}
      </main>

      {workbench}

      {isWorkbenchOpen && (
        <div
          className="bg-black/40 absolute inset-0 z-20 lg:hidden"
          onClick={onCloseWorkbench}
        />
      )}
    </div>
  );
}

