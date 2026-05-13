import { Sidebar } from './Sidebar.js';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background text-text-main overflow-hidden">
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {children}
      </main>
      <Sidebar />
    </div>
  );
}