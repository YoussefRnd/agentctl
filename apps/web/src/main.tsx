import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.js';
import './index.css';
import 'highlight.js/styles/github-dark.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
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
      </QueryClientProvider>
    );
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
}
