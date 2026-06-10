import { Link } from 'react-router-dom';
import { GlassPanel } from '@agentctl/ui';
import { Sidebar } from './Sidebar';
import { SettingsSidebar } from './SettingsSidebar';

interface LayoutProps {
  children: React.ReactNode;
  sidebarType?: 'projects' | 'settings' | 'none';
}

export function Layout({ children, sidebarType = 'none' }: LayoutProps) {
  const titles = {
    projects: 'projects',
    settings: 'settings',
    none: null,
  };

  const pageTitle = titles[sidebarType];

  const sidebars = {
    projects: <Sidebar />,
    settings: <SettingsSidebar />,
    none: null,
  };

  const sidebarContent = sidebars[sidebarType];

  return (
    <div className="bg-background text-text-main relative flex h-screen w-full flex-col overflow-hidden">
      {/* Light Leaks with Refraction */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ filter: 'url(#liquid-distort)' }}
      >
        <div
          className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] animate-pulse rounded-full opacity-40 blur-[160px]"
          style={{ backgroundColor: 'var(--color-accent)', willChange: 'transform, filter' }} // Mauve
        />
        <div
          className="absolute top-[20%] -right-[5%] h-[50%] w-[50%] rounded-full opacity-20 blur-[180px]"
          style={{
            backgroundColor: '#89b4fa',
            animation: 'pulse 8s infinite',
            willChange: 'transform, filter',
          }} // Blue (Catppuccin Blue #89b4fa)
        />
        <div
          className="absolute -bottom-[10%] left-[20%] h-[45%] w-[45%] rounded-full opacity-30 blur-[160px]"
          style={{
            backgroundColor: 'var(--color-accent-secondary)',
            animation: 'pulse 12s infinite',
            willChange: 'transform, filter',
          }} // Lavender
        />
      </div>

      {/* Unified Top Navbar */}
      <div className="border-border/50 bg-background/50 relative z-40 border-b backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3">
          <div className="hidden w-[240px] shrink-0 items-center lg:flex">
            <Link
              to="/"
              className="text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
            >
              AGENTCTL
            </Link>
          </div>
          <div className="flex shrink-0 items-center pl-2 lg:hidden">
            <Link
              to="/"
              className="text-text-main font-sans text-[12px] font-black tracking-[0.4em] uppercase transition-opacity hover:opacity-80"
            >
              AGENTCTL
            </Link>
          </div>
          {pageTitle && (
            <div className="flex h-full min-w-0 flex-1 items-center">
              <div className="border-border/20 bg-surface/40 flex items-center gap-1.5 rounded-full border px-2.5 py-1">
                <span className="bg-accent/60 h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-text-muted text-[10px] font-bold tracking-[0.15em] uppercase">
                  {pageTitle}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spaced desktop grid body */}
      <div className="relative z-10 flex min-h-0 w-full flex-1 gap-3 overflow-hidden p-3">
        {sidebarContent && (
          <div className="z-20 hidden h-full w-[240px] shrink-0 lg:block">
            <GlassPanel className="h-full border-none shadow-2xl overflow-hidden rounded-3xl" intensity="high">
              {sidebarContent}
            </GlassPanel>
          </div>
        )}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-all duration-500 ease-in-out">
          <GlassPanel className="h-full border-none shadow-2xl overflow-hidden rounded-3xl" intensity="high">
            <div className="relative flex flex-grow flex-col overflow-hidden">{children}</div>
          </GlassPanel>
        </main>
      </div>

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
