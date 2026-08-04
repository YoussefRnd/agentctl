import React from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@agentctl/api-client';
import { GlassPanel, Input, Button } from '@agentctl/ui';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';

export function LoginView() {
  const [key, setKey] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
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
      <GlassPanel className="animate-in fade-in zoom-in w-full max-w-sm rounded-2xl p-6 shadow-2xl duration-300">
        <div className="mb-6 text-center">
          <h1 className="text-text-main mb-1 text-xl font-bold tracking-tight">
            AgentCtl Authentication
          </h1>
          <p className="text-text-muted text-xs opacity-75">
            Enter your secret access key to unlock the workspace
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-key"
              className="text-text-muted mb-1.5 block text-xs font-semibold"
            >
              Secret access key
            </label>
            <div className="relative">
              <Input
                id="login-key"
                type={showPassword ? 'text' : 'password'}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                }}
                placeholder="Paste your access key..."
                className="!h-10 w-full pr-10 font-mono text-sm"
                required
              />
              <button
                type="button"
                onClick={() => {
                  setShowPassword(!showPassword);
                }}
                className="text-text-muted hover:text-text-main absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer p-1 transition-colors"
                title={showPassword ? 'Hide key' : 'Show key'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="border-danger/30 bg-danger/10 text-danger flex items-center justify-center gap-2 rounded-xl border p-3 text-center text-xs font-medium">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !key.trim()}
            className="!h-10 w-full text-xs font-bold"
          >
            {isLoading ? 'Verifying...' : 'Unlock workspace'}
          </Button>
        </form>

        <p className="text-text-muted/60 mt-6 text-center text-[11px] leading-relaxed">
          Check server terminal output for your one-time access key.
        </p>
      </GlassPanel>
    </div>
  );
}
