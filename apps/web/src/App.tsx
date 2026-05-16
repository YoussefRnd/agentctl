import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { SessionView } from './routes/SessionView.js';
import { LoginView } from './routes/LoginView.js';
import { NewProjectPalette } from './components/NewProjectPalette.js';

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
