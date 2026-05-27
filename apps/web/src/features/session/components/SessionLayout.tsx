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
    <div className="bg-background relative flex h-screen w-full overflow-hidden flex-col">
      {/* Unified Top Navbar */}
      <div className="z-40 border-b border-border/50 bg-background/50 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3">
          <div className="w-[240px] shrink-0 lg:flex hidden items-center">
            <h2 className="text-text-main text-[12px] font-black uppercase tracking-[0.4em] font-sans">
              AGENTCTL
            </h2>
          </div>
          <div className="lg:hidden flex shrink-0 items-center pl-2">
            <h2 className="text-text-main text-[12px] font-black uppercase tracking-[0.4em] font-sans">
              AGENTCTL
            </h2>
          </div>
          <div className="flex-1 flex min-w-0 h-full items-center">
            {header}
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 w-full overflow-hidden p-3 gap-3">
        {/* Desktop Sidebar */}
        <div className="z-20 hidden w-[240px] shrink-0 lg:block h-full">
          <div className="terminal-glass h-full rounded-3xl border border-border shadow-2xl overflow-hidden">
            {sidebar}
          </div>
        </div>

        {/* Mobile Sidebar */}
        <aside
          className={`bg-background/95 backdrop-blur-2xl fixed inset-y-0 left-0 z-50 w-[300px] border-r border-border transition-transform duration-500 cubic-bezier(0.16, 1, 0.3, 1) lg:hidden ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-full flex-col p-4">{sidebar}</div>
        </aside>

        {isMobileSidebarOpen && (
          <div
            className="bg-black/60 backdrop-blur-md fixed inset-0 z-40 lg:hidden transition-opacity duration-500"
            onClick={onCloseMobileSidebar}
          />
        )}

        {/* Main Content Area */}
        <main className="terminal-glass relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border shadow-2xl transition-all duration-500 ease-in-out rounded-3xl bg-surface/30">
          <div className="flex-1 overflow-hidden flex flex-col relative">
            {children}
          </div>
        </main>

        {/* Workbench (Inspector) */}
        <div className="h-full flex shrink-0 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1)">
          {workbench}
        </div>
      </div>

      {/* Light Leaks with Refraction */}
      <div 
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ filter: 'url(#liquid-distort)' }}
      >
        <div 
          className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full opacity-20 blur-[160px] animate-pulse"
          style={{ backgroundColor: 'var(--color-accent)', willChange: 'transform, filter' }} // Mauve
        />
        <div 
          className="absolute top-[20%] -right-[5%] h-[50%] w-[50%] rounded-full opacity-10 blur-[180px]"
          style={{ backgroundColor: '#89b4fa', animation: 'pulse 8s infinite', willChange: 'transform, filter' }} // Blue (Catppuccin Blue #89b4fa)
        />
        <div 
          className="absolute -bottom-[10%] left-[20%] h-[45%] w-[45%] rounded-full opacity-15 blur-[160px]"
          style={{ backgroundColor: 'var(--color-accent-secondary)', animation: 'pulse 12s infinite', willChange: 'transform, filter' }} // Lavender
        />
      </div>

      {isWorkbenchOpen && (
        <div
          className="bg-black/10 absolute inset-0 z-20 lg:hidden pointer-events-auto"
          onClick={onCloseWorkbench}
        />
      )}

      {/* Liquid Refraction Filter */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <filter id="liquid-distort">
          <feTurbulence type="fractalNoise" baseFrequency="0.01" numOctaves="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" />
        </filter>
      </svg>
    </div>
  );
}
