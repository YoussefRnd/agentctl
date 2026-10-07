import { createRoot } from 'react-dom/client';
import { PerformanceLab } from './PerformanceLab';
import '../index.css';

// Fixtures cannot accidentally reach a local server, even if one is running.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  if (/^\/api(?:\/|$)/.test(url.pathname)) {
    return Promise.reject(
      new Error(`Performance fixture attempted an API request: ${url.pathname}`),
    );
  }
  return originalFetch(input, init);
};

document.documentElement.setAttribute('data-theme', 'mocha');
// Deliberately omit StrictMode: its development replays distort render counts.
createRoot(document.getElementById('root')!).render(<PerformanceLab />);
