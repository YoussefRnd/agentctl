import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@agentctl/api-client';
import { GlassPanel, Input, Button } from '@agentctl/ui';

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
        localStorage.setItem('agentctl_token', key);
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
      <GlassPanel className="animate-in fade-in zoom-in w-full max-w-sm p-6 shadow-2xl duration-300">
        <div className="mb-6 text-center">
          <h1 className="mb-1 text-2xl font-black tracking-widest text-white uppercase">
            AGENTCTL::AUTH
          </h1>
          <p className="text-text-muted caption-2xs">
            ENTER_DECRYPT_KEY_TO_ACCESS_WORKSPACE
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-key"
              className="text-text-muted mb-1.5 block label-3xs"
            >
              SECRET_ACCESS_KEY
            </label>
            <Input
              id="login-key"
              type="password"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder="••••••••••••••••"
              className="!h-10 w-full text-center tracking-[0.5em]"
              required
            />
          </div>

          {error && (
            <div className="border-surface-tertiary bg-surface-secondary text-danger rounded-md border p-2 text-center text-[10px] font-bold uppercase">
              ERROR::ACCESS_DENIED::{error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="!h-10 w-full text-[12px] font-black"
          >
            {isLoading ? 'VERIFYING...' : 'UNLOCK_WORKSPACE'}
          </Button>
        </form>

        <p className="text-text-muted/40 mt-6 text-center text-[9px] font-bold tracking-tighter uppercase">
          Check server stdout for the one-time access key.
        </p>
      </GlassPanel>
    </div>
  );
}
