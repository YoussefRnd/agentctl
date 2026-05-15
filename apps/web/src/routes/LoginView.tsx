import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api-client.js';

export function LoginView() {
  const [key, setKey] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        await apiClient.fetch('/api/login', {
          method: 'POST',
          body: JSON.stringify({ secret: key }),
        });
        void navigate('/');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid login key');
      } finally {
        setIsLoading(false);
      }
    })();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-xl animate-in fade-in zoom-in duration-300">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-text mb-2">Agent Workbench</h1>
          <p className="text-text-muted">Enter your one-time login key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="login-key" className="block text-sm font-medium text-text-muted mb-2">
              One-time login key
            </label>
            <input
              id="login-key"
              type="password"
              value={key}
              onChange={(e) => { setKey(e.target.value); }}
              placeholder="••••••••••••••••"
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-text outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500 animate-in fade-in slide-in-from-top-1">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="w-full rounded-xl bg-accent px-6 py-3 font-semibold text-background transition-all hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Verifying...' : 'Unlock Workspace'}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-text-muted">
          Check your server logs for the one-time login key.
        </p>
      </div>
    </div>
  );
}
