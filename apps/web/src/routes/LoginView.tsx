import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@agentctl/api-client';
import { GlassPanel, Input, Button } from '@agentctl/ui';
import { KeyRound, ShieldAlert, Laptop } from 'lucide-react';

export function LoginView() {
  const [key, setKey] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const navigate = useNavigate();

  React.useEffect(() => {
    if (window.electronAPI) {
      void navigate('/', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tokenInput = key.trim();
    if (!tokenInput) return;

    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        // Try pairing token consumption first
        await apiClient.fetch<{ success: true }>('/api/auth/pairing/consume', {
          method: 'POST',
          body: JSON.stringify({ pairingToken: tokenInput }),
        });

        void navigate('/');
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Invalid or expired pairing code. Please generate a new link.',
        );
      } finally {
        setIsLoading(false);
      }
    })();
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <GlassPanel className="animate-in fade-in zoom-in w-full max-w-sm rounded-xl p-6 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="bg-accent/15 text-accent mb-3 flex h-11 w-11 items-center justify-center rounded-xl">
            <KeyRound className="h-5 w-5" />
          </div>
          <h1 className="text-text-main mb-1 text-xl font-bold tracking-tight">
            Pair with Agentctl
          </h1>
          <p className="text-text-muted text-xs leading-relaxed opacity-75">
            Enter the one-time pairing code from your server terminal or an existing AgentCtl
            session.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="pairing-key"
              className="text-text-muted mb-1.5 block text-xs font-semibold"
            >
              One-time pairing code
            </label>
            <Input
              id="pairing-key"
              type="text"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              placeholder="Paste pairing code..."
              className="!h-10 w-full font-mono text-xs"
              autoFocus
              required
            />
          </div>

          {error && (
            <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-xl border p-3 text-left text-xs font-medium">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            isLoading={isLoading}
            disabled={!key.trim()}
            className="!h-10 w-full text-xs font-bold"
          >
            Connect device
          </Button>
        </form>

        <div className="border-border/30 text-text-muted mt-6 flex items-center justify-center gap-2 border-t pt-4 text-[11px] opacity-70">
          <Laptop className="h-3.5 w-3.5" />
          <span>Desktop & local development connect automatically</span>
        </div>
      </GlassPanel>
    </div>
  );
}
