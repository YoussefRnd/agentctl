import { Routes, Route } from 'react-router-dom';
import { Layout } from './features/shell/components/Layout';
import { SessionView } from './routes/SessionView';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';
import { SetupWizard } from './features/settings/components/SetupWizard';
import { SettingsPage } from './features/settings/components/SettingsPage';

export function App() {
 return (
  <>
   <SetupWizard />
   <Routes>
    <Route path="/login" element={<LoginView />} />
    <Route
     path="/"
     element={
      <Layout sidebarType="projects">
       <NewProjectPalette />
      </Layout>
     }
    />
    <Route
     path="/settings"
     element={
      <Layout sidebarType="settings">
       <SettingsPage />
      </Layout>
     }
    />
    <Route
     path="/sessions/:sessionId"
     element={<SessionView />}
    />
   </Routes>
  </>
 );
}
