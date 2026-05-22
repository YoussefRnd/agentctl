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
    <div className="bg-black flex min-h-screen items-center justify-center p-4">
      <div className="terminal-glass animate-in fade-in zoom-in w-full max-w-sm rounded-sm p-6 shadow-2xl duration-300">
        <div className="mb-6 text-center">
          <h1 className="text-white mb-1 text-2xl font-black uppercase tracking-widest">AGENTCTL::AUTH</h1>
          <p className="text-text-muted text-[10px] font-bold uppercase tracking-tight">ENTER_DECRYPT_KEY_TO_ACCESS_WORKSPACE</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-key" className="text-text-muted mb-1.5 block text-[9px] font-black uppercase tracking-widest">
              SECRET_ACCESS_KEY
            </label>
            <input
              id="login-key"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder="••••••••••••••••"
              className="terminal-input w-full !h-10 text-center tracking-[0.5em]"
              required
              autoFocus
            />
          </div>

          {error && (
            <div className="border border-white/10 bg-white/5 p-2 text-[10px] font-bold text-white uppercase text-center">
              ERROR::ACCESS_DENIED::{error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="terminal-button w-full !h-10 text-[12px] font-black"
          >
            {isLoading ? 'VERIFYING...' : 'UNLOCK_WORKSPACE'}
          </button>
        </form>

        <p className="text-text-muted/40 mt-6 text-center text-[9px] font-bold uppercase tracking-tighter">
          Check server stdout for the one-time access key.
        </p>
      </div>
    </div>
  );
}

