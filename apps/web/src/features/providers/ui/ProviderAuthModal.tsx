import { useState, useMemo } from 'react';
import { Key, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@agentctl/ui';
import { getProviderEnvKeys, validateApiKey, type ProviderDiscovery } from '@agentctl/shared';
import { useProviders } from '../api/useProviders.js';

export interface ProviderAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: ProviderDiscovery | null | undefined;
  sessionId: string | null;
}

export function ProviderAuthModal({
  isOpen,
  onClose,
  activeProvider,
  sessionId,
}: ProviderAuthModalProps) {
  if (!activeProvider) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-border bg-brand-mantle p-5 shadow-2xl sm:max-w-md">
        <DialogHeader className="gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="bg-accent/15 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <Key className="h-4 w-4" />
            </div>
            <DialogTitle className="text-text-main text-sm font-semibold tracking-normal normal-case">
              Authenticate {activeProvider.label}
            </DialogTitle>
          </div>
          <DialogDescription className="text-text-muted text-xs font-normal tracking-normal normal-case opacity-90">
            Choose an authentication method or provide your API key for {activeProvider.label}.
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <ProviderAuthModalBody
            key={activeProvider.id}
            activeProvider={activeProvider}
            sessionId={sessionId}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProviderAuthModalBody({
  activeProvider,
  sessionId,
  onClose,
}: {
  activeProvider: ProviderDiscovery;
  sessionId: string | null;
  onClose: () => void;
}) {
  const { updateProviderConfig, isUpdatingConfig, login, isLoggingIn } = useProviders(sessionId);

  const [localEnvs, setLocalEnvs] = useState<Record<string, string>>({});
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

  const envKeys = useMemo(() => {
    return getProviderEnvKeys(activeProvider);
  }, [activeProvider]);

  const keysValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const key of envKeys) {
      values[key] = localEnvs[key] || activeProvider.customEnv[key] || '';
    }
    return values;
  }, [activeProvider, envKeys, localEnvs]);

  const getKeyError = (key: string): string | null => {
    const hasLocalValue = key in localEnvs;
    if (hasLocalValue) {
      return validateApiKey(key, keysValues[key]);
    }
    if (activeProvider.customEnvConfigured[key]) return null;
    return validateApiKey(key, keysValues[key]);
  };

  const isPending = isUpdatingConfig || isLoggingIn;

  const handleSave = () => {
    const updates = { ...localEnvs };
    updateProviderConfig(
      { providerId: activeProvider.id, customEnv: updates },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const authMethods = activeProvider.authMethods;
  const hasAuthMethods = authMethods.length > 0;
  const hasEnvKeys = envKeys.length > 0;

  return (
    <div className="mt-3 flex flex-col gap-4 font-sans text-xs">
      {/* Auth methods */}
      <div className="flex flex-col gap-2">
        {authMethods.map((method, idx) => (
          <button
            key={method.id}
            type="button"
            onClick={() => {
              if (method.id === 'api_key') {
                setShowApiKeyInput((prev) => !prev);
              } else {
                login({ providerId: activeProvider.id, methodId: method.id });
              }
            }}
            disabled={isPending}
            className={`flex h-9 w-full items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors disabled:opacity-40 ${
              idx === 0
                ? 'bg-accent text-brand-crust font-semibold hover:opacity-90 active:scale-[0.98]'
                : 'border-border/50 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 border'
            }`}
          >
            {isLoggingIn ? 'Authenticating...' : method.name}
          </button>
        ))}

        {hasEnvKeys && !authMethods.some((m) => m.id === 'api_key') && (
          <button
            type="button"
            onClick={() => {
              setShowApiKeyInput((prev) => !prev);
            }}
            disabled={isPending}
            className={`border-border/50 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 flex h-9 w-full items-center justify-center rounded-lg border px-4 text-xs font-medium transition-colors disabled:opacity-40 ${
              !hasAuthMethods
                ? 'bg-accent text-brand-crust border-none font-semibold hover:opacity-90'
                : ''
            }`}
          >
            API key
          </button>
        )}
      </div>

      {/* API Key Form */}
      {(showApiKeyInput || (!hasAuthMethods && hasEnvKeys)) && (
        <div className="border-border/20 space-y-3 border-t pt-3">
          {envKeys.map((key: string) => {
            const errorMsg = getKeyError(key);
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label
                    htmlFor={`modal-${key}`}
                    className="text-text-muted font-mono text-xs font-medium"
                  >
                    {key}
                  </label>
                  {errorMsg && (
                    <span className="text-danger flex items-center gap-1 text-[11px] font-normal">
                      <AlertCircle className="inline h-3 w-3" />
                      {errorMsg}
                    </span>
                  )}
                </div>
                <input
                  id={`modal-${key}`}
                  type="password"
                  value={keysValues[key] ?? ''}
                  placeholder={
                    activeProvider.customEnvConfigured[key]
                      ? 'Configured (enter to replace)'
                      : `Enter ${key}...`
                  }
                  onChange={(e) => {
                    setLocalEnvs({
                      ...localEnvs,
                      [key]: e.target.value,
                    });
                  }}
                  className={`border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/40 focus:border-accent/50 focus:ring-accent/40 h-9 w-full rounded-lg border px-3 font-mono text-xs transition-colors duration-200 outline-none focus:ring-1 ${
                    errorMsg ? 'border-danger/50 focus:border-danger/70 focus:ring-danger/40' : ''
                  }`}
                />
              </div>
            );
          })}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border-border/40 text-text-muted hover:text-text-main hover:bg-surface-secondary/50 flex h-8 items-center justify-center rounded-lg border px-3.5 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || envKeys.some((key: string) => getKeyError(key) !== null)}
              className="bg-accent text-brand-crust flex h-8 items-center justify-center rounded-lg px-4 text-xs font-semibold transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
            >
              {isUpdatingConfig ? 'Saving...' : 'Save API key'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
