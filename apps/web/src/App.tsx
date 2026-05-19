import { Routes, Route } from 'react-router-dom';
import { Layout } from './features/shell/components/Layout';
import { SessionView } from './routes/SessionView';
import { LoginView } from './routes/LoginView';
import { NewProjectPalette } from './features/project/components/NewProjectPalette';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route
        path="/"
        element={
          <Layout showSidebar={true}>
            <NewProjectPalette />
          </Layout>
        }
      />
      <Route
        path="/sessions/:sessionId"
        element={
          <Layout showSidebar={false}>
            <SessionView />
          </Layout>
        }
      />
    </Routes>
  );
}
