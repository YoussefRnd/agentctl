import { Sidebar } from './Sidebar';
import { SettingsSidebar } from './SettingsSidebar';

interface LayoutProps {
  children: React.ReactNode;
  sidebarType?: 'projects' | 'settings' | 'none';
}

export function Layout({ children, sidebarType = 'none' }: LayoutProps) {
  return (
    <div className="bg-background text-text-main relative flex h-screen w-full overflow-hidden">
      <div className="bg-accent-glow animate-pulse-slow pointer-events-none absolute top-[-20%] right-[-10%] h-[800px] w-[800px] rounded-full opacity-50 blur-[150px]" />
      <div className="bg-accent-glow/50 animate-float pointer-events-none absolute bottom-[-20%] left-[-10%] h-[600px] w-[600px] rounded-full opacity-40 blur-[120px]" />

      {sidebarType === 'projects' && <Sidebar />}
      {sidebarType === 'settings' && <SettingsSidebar />}
      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
