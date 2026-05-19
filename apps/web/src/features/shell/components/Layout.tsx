import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
  showSidebar?: boolean;
}

export function Layout({ children, showSidebar = false }: LayoutProps) {
  return (
    <div className="flex h-screen w-full bg-background text-text-main overflow-hidden">
      {showSidebar && <Sidebar />}
      <main className="min-w-0 flex-1 flex flex-col relative overflow-hidden">{children}</main>
    </div>
  );
}
