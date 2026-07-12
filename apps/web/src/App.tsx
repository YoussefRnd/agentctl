import { Routes, Route } from 'react-router-dom';
import { Shell } from './features/shell/components/Shell';
import { Sidebar } from './features/shell/components/Sidebar';
import { SettingsSidebar } from './features/shell/components/SettingsSidebar';
import { SessionView } from './routes/SessionView';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';
import { SetupWizard } from './features/settings/components/SetupWizard';
import { SettingsPage } from './features/settings/components/SettingsPage';
import { useSettings } from './hooks/useSettings';
import { FontZoomIndicator } from './features/shell/components/FontZoomIndicator';

export function App() {
  const { settings } = useSettings();

  return (
    <>
      <FontZoomIndicator fontConfig={settings?.fontConfig} />
      <SetupWizard />
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route
          path="/"
          element={
            <Shell nav={null} sidebar={<Sidebar />}>
              <NewProjectPalette />
            </Shell>
          }
        />
        <Route
          path="/settings"
          element={
            <Shell nav={null} sidebar={<SettingsSidebar />}>
              <SettingsPage />
            </Shell>
          }
        />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
      </Routes>
    </>
  );
}
