import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { App } from './App';
import { AppErrorBoundary } from './features/shell/components/AppErrorBoundary';
import './index.css';
import 'highlight.js/styles/github-dark.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
    mutations: {
      onError: (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Something went wrong';
        toast.error(message);
      },
    },
  },
});

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
