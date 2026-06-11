import { Routes, Route } from 'react-router-dom';
import { Layout } from './features/shell/components/Layout';
import { SessionView } from './routes/SessionView';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';
import { SetupWizard } from './features/settings/components/SetupWizard';
import { SettingsPage } from './features/settings/components/SettingsPage';
import { Sidebar } from './features/shell/components/Sidebar';
import { SettingsSidebar } from './features/shell/components/SettingsSidebar';
import { GlobalNav } from './features/shell/components/GlobalNav';

export function App() {
  return (
    <>
      <SetupWizard />
      <Routes>
        <Route path="/login" element={<LoginView />} />
        <Route
          path="/"
          element={
            <Layout sidebar={<Sidebar />} nav={<GlobalNav title="projects" />}>
              <NewProjectPalette />
            </Layout>
          }
        />
        <Route
          path="/settings"
          element={
            <Layout sidebar={<SettingsSidebar />} nav={<GlobalNav title="settings" />}>
              <SettingsPage />
            </Layout>
          }
        />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
      </Routes>
    </>
  );
}
