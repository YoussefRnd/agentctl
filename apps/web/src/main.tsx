import React from 'react';
import ReactDOM from 'react-dom/client';
import { setApiBaseUrl, extractAndPersistUrlToken, setAuthToken } from '@agentctl/api-client';
import { AppProviders } from './app/AppProviders.js';
import { App } from './app/App.js';
import './index.css';
import 'highlight.js/styles/github-dark.css';
import { initApiBaseUrl } from './shared/lib/api-base-url.js';

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

const rootElement = document.getElementById('root');
if (rootElement) {
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
        <AppProviders>
          <App />
        </AppProviders>
      </React.StrictMode>,
    );
  }

  void bootstrap(rootElement);
}
