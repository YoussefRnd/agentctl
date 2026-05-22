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
    <div className="bg-background relative flex h-full w-full overflow-hidden p-3 gap-3">
      {/* Desktop Sidebar */}
      <div className="z-20 hidden w-[240px] shrink-0 lg:block h-full">
        {sidebar}
      </div>

      {/* Mobile Sidebar */}
      <aside
        className={`bg-background border-border fixed inset-y-0 left-0 z-50 w-[280px] border-r transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) lg:hidden ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col p-2">{sidebar}</div>
      </aside>

      {isMobileSidebarOpen && (
        <div
          className="bg-black/60 backdrop-blur-sm fixed inset-0 z-40 lg:hidden transition-opacity duration-500"
          onClick={onCloseMobileSidebar}
        />
      )}

      {/* Main Content Area */}
      <main className="terminal-glass relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border shadow-2xl transition-all duration-500 ease-in-out">
        {header}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {children}
        </div>
      </main>

      {/* Workbench (Inspector) */}
      <div className="h-full flex shrink-0 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)">
        {workbench}
      </div>

      {isWorkbenchOpen && (
        <div
          className="bg-black/20 absolute inset-0 z-20 lg:hidden pointer-events-auto"
          onClick={onCloseWorkbench}
        />
      )}
    </div>
  );
}

