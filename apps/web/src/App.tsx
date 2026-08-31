import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { Shell } from './features/shell/components/Shell';
import { Sidebar } from './features/shell/components/Sidebar';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';
import { useSettings } from './hooks/useSettings';
import { useUIStore } from './shared';
import { FontZoomIndicator } from './features/shell/components/FontZoomIndicator';
import { FontConfigApplier } from './features/shell/components/FontConfigApplier';
import { SettingsDialog } from './features/settings/components/SettingsDialog';
import { CommandPalette } from './features/shell/components/CommandPalette';
import { GlobalDropzone } from './features/project/components/GlobalDropzone';
import { Spinner } from '@agentctl/ui';

const SessionView = lazy(() =>
  import('./routes/SessionView').then((m) => ({ default: m.SessionView })),
);
const SetupWizard = lazy(() =>
  import('./features/settings/components/SetupWizard').then((m) => ({ default: m.SetupWizard })),
);

function SettingsRouteRedirect() {
  const [searchParams] = useSearchParams();
  const openSettings = useUIStore((s) => s.openSettings);
  const requestedTab = searchParams.get('tab');
  const tab =
    requestedTab === 'providers' || requestedTab === 'mcp' || requestedTab === 'general'
      ? requestedTab
      : 'general';

  useEffect(() => {
    openSettings(tab);
  }, [openSettings, tab]);

  return <Navigate to="/" replace />;
}

export function App() {
  const { settings } = useSettings();
  const toggleSettings = useUIStore((s) => s.toggleSettings);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === ',' || e.code === 'Comma')) {
        e.preventDefault();
        e.stopPropagation();
        toggleSettings();
      }
      if (isMod && (e.key === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        toggleCommandPalette();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [toggleSettings, toggleCommandPalette]);

  return (
    <>
      <GlobalDropzone />
      <CommandPalette />
      <FontConfigApplier fontConfig={settings?.fontConfig} />
      <FontZoomIndicator />
      <SettingsDialog />
      <Suspense fallback={null}>
        <SetupWizard />
      </Suspense>
      <Suspense
        fallback={
          <div className="bg-background flex h-screen w-screen items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route
            path="/"
            element={
              <Shell
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
              </Shell>
            }
          />
          <Route path="/settings" element={<SettingsRouteRedirect />} />
          <Route path="/sessions/:sessionId" element={<SessionView />} />
        </Routes>
      </Suspense>
    </>
  );
}
