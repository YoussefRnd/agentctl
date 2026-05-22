import { Sidebar } from './Sidebar';
import { SettingsSidebar } from './SettingsSidebar';

interface LayoutProps {
  children: React.ReactNode;
  sidebarType?: 'projects' | 'settings' | 'none';
}

export function Layout({ children, sidebarType = 'none' }: LayoutProps) {
  return (
    <div className="bg-background text-text-main relative flex h-screen w-full overflow-hidden">
      {sidebarType === 'projects' && <Sidebar />}
      {sidebarType === 'settings' && <SettingsSidebar />}
      <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}



