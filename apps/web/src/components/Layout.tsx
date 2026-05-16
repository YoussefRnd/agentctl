import { Sidebar } from './Sidebar.js';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col bg-background text-text-main overflow-hidden lg:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 flex flex-col relative overflow-hidden border-l border-border">
        {children}
      </main>
    </div>
  );
}
