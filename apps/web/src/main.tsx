import React from 'react';
import ReactDOM from 'react-dom/client';
import { setDesktopCapability } from '@agentctl/api-client';
import { AppProviders } from './app/AppProviders.js';
import { App } from './app/App.js';
import './index.css';
import { extractPairingTokenFromUrl, initApiEnvironment } from './app/apiEnvironment.js';
import { journeyPerformance } from './shared/lib/performanceRecorder.js';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

if (journeyPerformance.enabled) {
  // Navigation timing starts before module download, unlike a mark inside bootstrap.
  journeyPerformance.begin('launch-to-typeable', '', 0);
  let navigationScope: string | undefined;
  document.addEventListener(
    'click',
    (event) => {
      if (
        event instanceof MouseEvent &&
        (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const path = isElectron ? destination.hash.slice(1).split('?')[0] : destination.pathname;
      const sessionId = /^\/sessions\/([^/]+)$/.exec(path)?.[1];
      const currentPath = isElectron
        ? window.location.hash.slice(1).split('?')[0]
        : window.location.pathname;
      if (path !== currentPath) {
        if (navigationScope)
          journeyPerformance.cancel('session-click-to-feed-painted', navigationScope);
        navigationScope = sessionId;
        if (sessionId) journeyPerformance.begin('session-click-to-feed-painted', sessionId);
      }
    },
    true,
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  async function bootstrap(element: HTMLElement) {
    // The development gallery must work even when the local server is offline.
    if (import.meta.env.DEV && window.location.pathname === '/_dev/ui') {
      const { UiGalleryRoute } = await import('./routes/UiGalleryRoute.js');
      ReactDOM.createRoot(element).render(
        <React.StrictMode>
          <UiGalleryRoute />
        </React.StrictMode>,
      );
      return;
    }

    const pairingToken = extractPairingTokenFromUrl();
    const baseUrl = await initApiEnvironment();

    // Electron keeps its per-launch capability in memory only.
    if (isElectron && window.electronAPI?.getServerSecret) {
      try {
        const secret = await window.electronAPI.getServerSecret();
        if (secret) {
          setDesktopCapability(secret);
        }
      } catch {
        // Protected requests will surface the startup failure.
      }
    } else if (pairingToken) {
      try {
        await fetch(`${baseUrl}/api/auth/pairing/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingToken }),
          credentials: 'include',
        });
      } catch {
        // The next protected request redirects to the manual pairing screen.
      }
    }

    ReactDOM.createRoot(element).render(
      <React.StrictMode>
        <AppProviders>
          <App />
        </AppProviders>
      </React.StrictMode>,
    );
  }

  void bootstrap(rootElement);
}
