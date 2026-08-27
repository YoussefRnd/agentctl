import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  queryClient,
  setApiBaseUrl,
  extractAndPersistUrlToken,
  setAuthToken,
} from '@agentctl/api-client';
import { ThemeProvider } from './contexts/ThemeProvider';
import { ProjectProvider } from './contexts/ProjectContext';
import { UpdateProvider } from './contexts/UpdateContext';
import { App } from './App';
import { AppErrorBoundary } from './features/shell/components/AppErrorBoundary';
import './index.css';
import 'highlight.js/styles/github-dark.css';
import { initApiBaseUrl } from './shared/lib/api-base-url';

const isElectron = !!window.electronAPI;
const Router = isElectron ? HashRouter : BrowserRouter;

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
          <ProjectProvider>
            <UpdateProvider>
              <Router>
                <AppErrorBoundary key={appKey} onRetry={handleRetry}>
                  <App />
                </AppErrorBoundary>
              </Router>
            </UpdateProvider>
          </ProjectProvider>
        </ThemeProvider>
        {/* Toaster lives outside the error boundary so toasts survive crashes */}
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors={false}
          closeButton
          toastOptions={{
            duration: 4000,
            unstyled: true,
            classNames: {
              toast:
                'bg-brand-mantle/95 text-text-main pointer-events-auto flex w-auto min-w-[260px] max-w-[400px] items-center gap-3 rounded-xl border border-border/40 p-3 shadow-2xl animate-in fade-in slide-in-from-right-5',
              title: 'text-[12px] font-bold tracking-wide text-white',
              description: 'text-[11px] font-medium text-text-muted opacity-80',
              actionButton: 'terminal-button',
              cancelButton:
                'text-text-muted hover:text-white px-2 py-1 text-[10px] font-bold uppercase transition-colors',
              closeButton:
                'hover:text-white text-text-muted transition-colors !bg-transparent !border-none',
            },
          }}
        />
      </QueryClientProvider>
    );
  }

  async function bootstrap(element: HTMLElement) {
    extractAndPersistUrlToken();
    const baseUrl = await initApiBaseUrl();
    setApiBaseUrl(baseUrl);

    // Auto-login for Electron desktop app
    if (isElectron && window.electronAPI?.getServerSecret) {
      try {
        const secret = await window.electronAPI.getServerSecret();
        if (secret) {
          setAuthToken(secret);
          await fetch(`${baseUrl}/api/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify({ secret }),
            credentials: 'include',
          });
        }
      } catch {
        // Auto-login failed — user lands on login page
      }
    }

    ReactDOM.createRoot(element).render(
      <React.StrictMode>
        <Root />
      </React.StrictMode>,
    );
  }

  void bootstrap(rootElement);
}
