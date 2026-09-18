import { useState, useMemo } from 'react';
import type { ProviderDiscovery } from '@agentctl/shared';
import { getProviderEnvKeys, validateApiKey } from '@agentctl/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  Button,
  Input,
} from '@agentctl/ui';
import { ProviderIcon } from '@/shared';
import { KeyRound, CheckCircle2, AlertCircle, RefreshCw, Loader2, LogIn } from 'lucide-react';

interface AuthDialogProps {
  provider: ProviderDiscovery | null;
  onClose: () => void;
  onSaveEnv: (providerId: string, customEnv: Record<string, string>) => void;
  onRefresh: (providerId: string) => void;
  onLogin?: (params: { providerId: string; methodId: string }) => void;
  isLoggingIn?: boolean;
  isUpdatingConfig?: boolean;
  isRefreshing?: boolean;
}

export function AuthDialog({
  provider,
  onClose,
  onSaveEnv,
  onRefresh,
  onLogin,
  isLoggingIn,
  isUpdatingConfig,
  isRefreshing,
}: AuthDialogProps) {
  return (
    <Dialog
      open={!!provider}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md p-6">
        {provider && (
          <AuthDialogBody
            key={provider.id}
            provider={provider}
            onClose={onClose}
            onSaveEnv={onSaveEnv}
            onRefresh={onRefresh}
            onLogin={onLogin}
            isLoggingIn={isLoggingIn}
            isUpdatingConfig={isUpdatingConfig}
            isRefreshing={isRefreshing}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuthDialogBody({
  provider,
  onClose,
  onSaveEnv,
  onRefresh,
  onLogin,
  isLoggingIn,
  isUpdatingConfig,
  isRefreshing,
}: {
  provider: ProviderDiscovery;
  onClose: () => void;
  onSaveEnv: (providerId: string, customEnv: Record<string, string>) => void;
  onRefresh: (providerId: string) => void;
  onLogin?: (params: { providerId: string; methodId: string }) => void;
  isLoggingIn?: boolean;
  isUpdatingConfig?: boolean;
  isRefreshing?: boolean;
}) {
  const [localEnv, setLocalEnv] = useState<Record<string, string>>({});

  const envKeys = useMemo(() => {
    return getProviderEnvKeys(provider);
  }, [provider]);

  const authMethods = provider.agent?.authMethods ?? provider.authMethods ?? [];
  const interactiveMethods = authMethods.filter((m) => m.type !== 'env_var');
  const hasEnvKeys = envKeys.length > 0;

  const keysValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const key of envKeys) {
      values[key] = localEnv[key] || provider.customEnv[key] || '';
    }
    return values;
  }, [envKeys, localEnv, provider.customEnv]);

  const getKeyError = (key: string): string | null => {
    const hasLocal = key in localEnv;
    if (hasLocal) {
      return validateApiKey(key, keysValues[key]);
    }
    if (provider.customEnvConfigured[key]) return null;
    return validateApiKey(key, keysValues[key]);
  };

  const hasInvalidKey = envKeys.some((k) => getKeyError(k) !== null);
  const isPending = Boolean(isUpdatingConfig || isLoggingIn || isRefreshing);

  const handleSave = () => {
    const updates = { ...localEnv };
    onSaveEnv(provider.id, updates);
    onClose();
  };

  const handleTestConnection = () => {
    onRefresh(provider.id);
  };

  const isAuthed = provider.authState === 'authenticated';
  const isNeedsAuth = provider.authState === 'needs_auth';
  const isError = provider.authState === 'error';

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <ProviderIcon provider={provider} size="sm" className="shrink-0" />
          <div>
            <DialogTitle className="text-sm font-bold tracking-tight">
              {provider.agent?.name ?? provider.label} Authentication
            </DialogTitle>
            <p className="text-text-muted mt-0.5 text-xs">
              Manage credentials and authentication methods for this provider
            </p>
          </div>
        </div>
      </DialogHeader>

      {/* Real-time Status Card */}
      <div
        className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
          isAuthed
            ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
            : isNeedsAuth
              ? 'border-amber-500/20 bg-amber-500/5 text-amber-300'
              : isError
                ? 'border-red-500/20 bg-red-500/5 text-red-300'
                : 'border-border/30 bg-surface-secondary/20 text-text-muted'
        }`}
      >
        {isAuthed ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : isNeedsAuth ? (
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {isAuthed
              ? 'Authenticated'
              : isNeedsAuth
                ? 'Authentication Required'
                : isError
                  ? 'Connection / Probe Error'
                  : 'Status Unknown'}
          </div>
          <p className="mt-0.5 text-[11px] leading-normal opacity-85">
            {isAuthed
              ? 'Credentials are valid and capabilities are loaded.'
              : isNeedsAuth
                ? 'Please provide an API key or authenticate below to enable this provider.'
                : isError
                  ? 'Failed to communicate with the provider. Verify credentials and try again.'
                  : 'Sign in or enter an API key to enable.'}
          </p>
        </div>
      </div>

      {/* Interactive ACP Agent Login Methods */}
      {interactiveMethods.length > 0 && (
        <div className="space-y-2">
          <div className="text-text-muted text-[11px] font-semibold tracking-wider uppercase opacity-75">
            Sign In with Provider
          </div>
          <div className="space-y-2">
            {interactiveMethods.map((method) => (
              <Button
                key={method.id}
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => {
                  if (onLogin) {
                    onLogin({ providerId: provider.id, methodId: method.id });
                  } else {
                    onRefresh(provider.id);
                  }
                }}
                className="flex h-9 w-full items-center justify-between rounded-lg px-3.5 text-xs font-semibold"
              >
                <span className="flex items-center gap-2">
                  <LogIn className="h-3.5 w-3.5" />
                  {method.name ?? method.id}
                </span>
                {isLoggingIn ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="text-text-muted text-[10px] font-normal">Connect →</span>
                )}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Environment Variables / API Key Section */}
      {hasEnvKeys && (
        <div className="space-y-3">
          <div className="text-text-muted text-[11px] font-semibold tracking-wider uppercase opacity-75">
            Environment & API Keys
          </div>
          <div className="space-y-2.5">
            {envKeys.map((key) => {
              const errorMsg = getKeyError(key);
              const isConfigured = provider.customEnvConfigured[key];
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={`auth-env-${key}`}
                      className="text-text-main font-mono text-xs font-medium"
                    >
                      {key}
                    </label>
                    {isConfigured && !errorMsg && (
                      <span className="text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
                        ✓ Configured
                      </span>
                    )}
                    {errorMsg && (
                      <span className="text-danger flex items-center gap-1 text-[10px] font-medium">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {errorMsg}
                      </span>
                    )}
                  </div>
                  <Input
                    id={`auth-env-${key}`}
                    type="password"
                    value={keysValues[key] ?? ''}
                    placeholder={
                      isConfigured ? 'Configured (enter new value to update)' : `Enter ${key}...`
                    }
                    onChange={(e) => {
                      setLocalEnv({ ...localEnv, [key]: e.target.value });
                    }}
                    className={`font-mono text-xs ${errorMsg ? 'border-danger/50' : ''}`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminal instruction for CLI providers */}
      {!hasEnvKeys && interactiveMethods.length === 0 && (
        <div className="border-border/20 bg-surface-secondary/15 space-y-1.5 rounded-lg border p-3">
          <div className="text-text-main text-xs font-medium">CLI Login</div>
          <p className="text-text-muted text-[11px] leading-relaxed">
            Run{' '}
            <code className="text-text-main bg-surface/50 rounded px-1 py-0.5 font-mono">
              {provider.command} login
            </code>{' '}
            in your terminal, then click <strong>Refresh Status</strong> below.
          </p>
        </div>
      )}

      <DialogFooter className="flex items-center justify-between gap-2 pt-2 sm:justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleTestConnection}
          className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Checking...' : 'Refresh Status'}
        </Button>

        <div className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">
              Close
            </Button>
          </DialogClose>
          {hasEnvKeys && (
            <Button
              variant="solid"
              size="sm"
              disabled={isPending || hasInvalidKey}
              onClick={handleSave}
              className="bg-accent text-brand-crust h-8 px-4 text-xs font-semibold hover:opacity-90"
            >
              {isUpdatingConfig ? 'Saving...' : 'Save Credentials'}
            </Button>
          )}
        </div>
      </DialogFooter>
    </div>
  );
}
