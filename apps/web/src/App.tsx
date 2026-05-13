import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { SessionView } from './routes/SessionView.js';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Select a session to begin
          </div>
        } />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
      </Routes>
    </Layout>
  );
}
