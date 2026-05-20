import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@agentctl/api-client';
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
        <BrowserRouter>
          <AppErrorBoundary key={appKey} onRetry={handleRetry}>
            <App />
          </AppErrorBoundary>
        </BrowserRouter>
        {/* Toaster lives outside the error boundary so toasts survive crashes */}
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            duration: 5000,
            classNames: {
              toast: 'font-sans text-sm',
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
