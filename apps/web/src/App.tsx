import { Routes, Route } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { Layout } from './components/Layout.js';
import { SessionView } from './routes/SessionView.js';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in duration-500">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mb-6">
              <PlayCircle className="w-8 h-8 text-accent" />
            </div>
            <h2 className="text-xl font-bold mb-2">Welcome to Agent Workbench</h2>
            <p className="text-text-muted max-w-md mb-8 leading-relaxed">
              Select an existing session from the explorer on the right, or start a new one via the CLI.
            </p>
          </div>
        } />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
      </Routes>
    </Layout>
  );
}
