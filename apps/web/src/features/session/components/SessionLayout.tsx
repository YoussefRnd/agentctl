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
    <div className="bg-background relative flex h-screen w-full flex-col overflow-hidden">
      {/* Unified Top Navbar */}
      <div className="border-border/50 bg-background/50 z-40 border-b backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3">
          <div className="hidden w-[240px] shrink-0 items-center lg:flex">
            <h2 className="text-text-main font-sans text-[11px] font-bold tracking-[0.2em] uppercase">
              Agentctl
            </h2>
          </div>
          <div className="flex shrink-0 items-center pl-2 lg:hidden">
            <h2 className="text-text-main font-sans text-[11px] font-bold tracking-[0.2em] uppercase">
              Agentctl
            </h2>
          </div>
          <div className="flex h-full min-w-0 flex-1 items-center">{header}</div>
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1 gap-3 overflow-hidden p-3">
        {/* Desktop Sidebar */}
        <div className="z-20 hidden h-full w-[240px] shrink-0 lg:block">
          <div className="terminal-glass border-border h-full overflow-hidden rounded-xl border">
            {sidebar}
          </div>
        </div>

        {/* Mobile Sidebar */}
        <aside
          className={`bg-background/95 border-border cubic-bezier(0.16, 1, 0.3, 1) fixed inset-y-0 left-0 z-50 w-[300px] border-r backdrop-blur-2xl transition-transform duration-500 lg:hidden ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-full flex-col p-4">{sidebar}</div>
        </aside>

        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md transition-opacity duration-500 lg:hidden"
            onClick={onCloseMobileSidebar}
          />
        )}

        {/* Main Content Area */}
        <main className="terminal-glass border-border bg-surface/30 relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border transition-all duration-500 ease-in-out">
          <div className="relative flex flex-1 flex-col overflow-hidden">{children}</div>
        </main>

        {/* Workbench (Inspector) */}
        <div className="cubic-bezier(0.16, 1, 0.3, 1) flex h-full shrink-0 transition-all duration-500">
          {workbench}
        </div>
      </div>

      {isWorkbenchOpen && (
        <div
          className="pointer-events-auto absolute inset-0 z-20 bg-black/10 lg:hidden"
          onClick={onCloseWorkbench}
        />
      )}
    </div>
  );
}
