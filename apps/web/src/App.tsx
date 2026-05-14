import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { SessionView } from './routes/SessionView.js';
import { NewProjectPalette } from './components/NewProjectPalette.js';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<NewProjectPalette />} />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
      </Routes>
    </Layout>
  );
}
