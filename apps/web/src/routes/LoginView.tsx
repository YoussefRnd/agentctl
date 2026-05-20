import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@agentctl/api-client';

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
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="bg-surface animate-in fade-in zoom-in w-full max-w-md rounded-2xl p-8 shadow-xl duration-300">
        <div className="mb-8 text-center">
          <h1 className="text-text mb-2 text-3xl font-bold">Agent Workbench</h1>
          <p className="text-text-muted">Enter your one-time login key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="login-key" className="text-text-muted mb-2 block text-sm font-medium">
              One-time login key
            </label>
            <input
              id="login-key"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder="••••••••••••••••"
              className="border-border bg-background text-text focus:border-accent focus:ring-accent/20 w-full rounded-xl border px-4 py-3 transition-all outline-none focus:ring-2"
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="animate-in fade-in slide-in-from-top-1 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="bg-accent text-background hover:bg-accent-hover w-full rounded-xl px-6 py-3 font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'Verifying...' : 'Unlock Workspace'}
          </button>
        </form>

        <p className="text-text-muted mt-8 text-center text-xs">
          Check your server logs for the one-time login key.
        </p>
      </div>
    </div>
  );
}
