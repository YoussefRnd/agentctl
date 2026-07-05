import { GlassPanel } from '@agentctl/ui';
import { ProgressBar } from './ProgressBar';

interface LayoutProps {
  children: React.ReactNode;
  nav?: React.ReactNode;
  sidebar?: React.ReactNode;
}

export function Layout({ children, nav, sidebar }: LayoutProps) {
  return (
    <div className="bg-background text-text-main relative flex h-screen w-full flex-col overflow-hidden">
      <ProgressBar />
      {nav}

      <div className="relative z-10 flex min-h-0 w-full flex-1 gap-3 overflow-hidden p-3">
        {sidebar && (
          <div className="z-20 hidden h-full w-[240px] shrink-0 lg:block">
            <GlassPanel
              className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
              intensity="high"
            >
              {sidebar}
            </GlassPanel>
          </div>
        )}

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-all duration-500 ease-in-out">
          <GlassPanel
            className="h-full overflow-hidden rounded-lg border-none shadow-2xl"
            intensity="high"
          >
            <div className="relative flex flex-grow flex-col overflow-hidden">{children}</div>
          </GlassPanel>
        </main>
      </div>
    </div>
  );
}
