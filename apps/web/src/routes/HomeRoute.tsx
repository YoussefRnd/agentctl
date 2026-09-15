import { AppShell, Sidebar } from '../app/shell/index.js';
import { NewProjectPalette } from '../features/projects/index.js';

export function HomeRoute() {
  return (
    <AppShell
      nav={
        <div className="flex h-full w-full items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-text-muted/40">/</span>
            <span className="text-text-muted font-medium">Workspaces</span>
          </div>
        </div>
      }
      sidebar={<Sidebar />}
    >
      <NewProjectPalette />
    </AppShell>
  );
}
