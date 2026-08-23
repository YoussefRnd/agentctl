import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Shell } from './features/shell/components/Shell';
import { Sidebar } from './features/shell/components/Sidebar';
import { SettingsSidebar } from './features/shell/components/SettingsSidebar';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';
import { useSettings } from './hooks/useSettings';
import { FontZoomIndicator } from './features/shell/components/FontZoomIndicator';
import { FontConfigApplier } from './features/shell/components/FontConfigApplier';
import { Spinner } from '@agentctl/ui';

const SessionView = lazy(() =>
  import('./routes/SessionView').then((m) => ({ default: m.SessionView })),
);
const SettingsPage = lazy(() =>
  import('./features/settings/components/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SetupWizard = lazy(() =>
  import('./features/settings/components/SetupWizard').then((m) => ({ default: m.SetupWizard })),
);

export function App() {
  const { settings } = useSettings();

  return (
    <>
      <FontConfigApplier fontConfig={settings?.fontConfig} />
      <FontZoomIndicator />
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
          <Route
            path="/settings"
            element={
              <Shell
                nav={
                  <div className="flex h-full w-full items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-text-muted/40">/</span>
                      <span className="text-text-muted font-medium">Settings</span>
                    </div>
                  </div>
                }
                sidebar={<SettingsSidebar />}
              >
                <SettingsPage />
              </Shell>
            }
          />
          <Route path="/sessions/:sessionId" element={<SessionView />} />
        </Routes>
      </Suspense>
    </>
  );
}
