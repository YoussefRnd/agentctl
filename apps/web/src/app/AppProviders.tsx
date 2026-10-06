import React, { useState } from 'react';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from './queryClient.js';
import { ThemeProvider } from '../shared/index.js';
import { UpdateProvider } from '../features/updates/index.js';
import { AppErrorBoundary } from './shell/index.js';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
const Router = isElectron ? HashRouter : BrowserRouter;

export interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [appKey, setAppKey] = useState(0);

  const handleRetry = () => {
    queryClient.clear();
    setAppKey((value) => value + 1);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UpdateProvider>
          <Router>
            <AppErrorBoundary key={appKey} onRetry={handleRetry}>
              {children}
            </AppErrorBoundary>
          </Router>
        </UpdateProvider>
      </ThemeProvider>
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
              'bg-brand-mantle/95 text-text-main pointer-events-auto flex w-auto min-w-0 max-w-[min(400px,calc(100vw-2rem))] items-center gap-3 rounded-lg border border-border/40 p-3 shadow-2xl animate-in fade-in slide-in-from-right-5',
            title:
              'min-w-0 text-[12px] font-bold tracking-wide text-text-main [overflow-wrap:anywhere]',
            description:
              'min-w-0 text-[11px] font-medium text-text-muted opacity-80 [overflow-wrap:anywhere]',
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
