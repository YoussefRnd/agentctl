import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  extractPairingTokenFromUrl,
  setApiBaseUrl,
  setDesktopCapability,
} from '@agentctl/api-client';
import { AppProviders } from './app/AppProviders.js';
import { App } from './app/App.js';
import './index.css';
import 'highlight.js/styles/github-dark.css';
import { initApiBaseUrl } from './shared/lib/api-base-url.js';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

const rootElement = document.getElementById('root');
if (rootElement) {
  async function bootstrap(element: HTMLElement) {
    const pairingToken = extractPairingTokenFromUrl();
    const baseUrl = await initApiBaseUrl();
    setApiBaseUrl(baseUrl);

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
