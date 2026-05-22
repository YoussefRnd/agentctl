import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@agentctl/api-client';
import { ThemeProvider } from './contexts/ThemeProvider';
import { App } from './App';
import { AppErrorBoundary } from './features/shell/components/AppErrorBoundary';
import './index.css';
import 'highlight.js/styles/github-dark.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  function Root() {
    const [appKey, setAppKey] = React.useState(0);

    const handleRetry = () => {
      queryClient.clear();
      setAppKey((value) => value + 1);
    };

    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AppErrorBoundary key={appKey} onRetry={handleRetry}>
              <App />
            </AppErrorBoundary>
          </BrowserRouter>
        </ThemeProvider>
        {/* Toaster lives outside the error boundary so toasts survive crashes */}
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors={false}
          closeButton
          toastOptions={{
            duration: 5000,
            unstyled: true,
            classNames: {
              toast: 'terminal-glass flex items-center gap-3 w-full p-3 rounded-sm border border-white/10 shadow-2xl animate-in fade-in slide-in-from-right-5',
              title: 'text-[12px] font-black uppercase tracking-widest text-white',
              description: 'text-[11px] font-bold uppercase tracking-tight text-text-muted opacity-60',
              actionButton: 'terminal-button',
              cancelButton: 'text-text-muted hover:text-white px-2 py-1 text-[10px] font-black uppercase transition-colors',
              closeButton: 'hover:text-white text-text-muted transition-colors !bg-transparent !border-none',
            },
          }}
        />
      </QueryClientProvider>
    );
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
