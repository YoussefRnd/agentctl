import { BrowserAuthInteraction } from './BrowserAuthInteraction';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Key,
  Terminal as TerminalIcon,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  LogIn,
  ChevronDown,
  ChevronRight,
  LogOut,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@agentctl/ui';
import {
  getProviderEnvKeys,
  validateApiKey,
  type ProviderDiscovery,
  type AuthMethod,
} from '@agentctl/shared';
import { getApiBaseUrl, getDesktopCapability } from '@agentctl/api-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useProviders } from '../api/useProviders.js';

export interface ProviderAuthDialogProps {
  provider: ProviderDiscovery | null;
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  onSuccess?: (providerId: string) => void;
}

export function ProviderAuthDialog({
  provider,
  isOpen,
  onClose,
  sessionId = null,
  onSuccess,
}: ProviderAuthDialogProps) {
  if (!provider) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-border bg-brand-mantle p-5 shadow-2xl sm:max-w-lg">
        <DialogHeader className="gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="bg-accent/15 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <Key className="h-4 w-4" />
            </div>
            <DialogTitle className="text-text-main text-sm font-semibold tracking-normal normal-case">
              {provider.label} Authentication
            </DialogTitle>
          </div>
          <DialogDescription className="text-text-muted text-xs font-normal tracking-normal normal-case opacity-90">
            {provider.authState === 'authenticated' || provider.authState === 'not_required'
              ? 'Agent is connected and ready to use.'
              : 'Authenticate using the method advertised by the agent.'}
          </DialogDescription>
        </DialogHeader>

        {isOpen && (
          <ProviderAuthDialogBody
            key={provider.id}
            provider={provider}
            sessionId={sessionId}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProviderAuthDialogBody({
  provider,
  sessionId,
  onClose,
  onSuccess,
}: {
  provider: ProviderDiscovery;
  sessionId: string | null;
  onClose: () => void;
  onSuccess?: (providerId: string) => void;
}) {
  const {
    login,
    cancelLogin,
    verifyProvider,
    logoutProvider,
    updateProviderConfigAsync,
    isLoggingOut,
  } = useProviders(sessionId);

  const [activeTerminalMethod, setActiveTerminalMethod] = useState<AuthMethod | null>(null);
  const [showAdvancedEnv, setShowAdvancedEnv] = useState(false);
  const [localEnv, setLocalEnv] = useState<Record<string, string>>({});
  const [isSavingEnv, setIsSavingEnv] = useState(false);

  const authMethods = useMemo(() => {
    return (provider.agent?.authMethods ?? provider.authMethods ?? []).filter(
      (method) => method.type !== 'env_var',
    );
  }, [provider]);

  const envKeys = useMemo(() => {
    return getProviderEnvKeys(provider);
  }, [provider]);

  useEffect(() => {
    if (authMethods.length === 0 && envKeys.length > 0) {
      setShowAdvancedEnv(true);
    }
  }, [authMethods.length, envKeys.length]);

  const isAuthenticating = provider.authState === 'authenticating' || !!activeTerminalMethod;
  const isVerifying = provider.authState === 'verifying';
  const isAuthenticated = provider.authState === 'authenticated';
  const isReadyWithoutAuth = provider.authState === 'not_required';
  const isError = provider.authState === 'error' || provider.connectionState === 'error';

  const authAttemptedRef = useRef(false);
  useEffect(() => {
    if (
      authAttemptedRef.current &&
      (provider.authState === 'authenticated' || provider.authState === 'not_required')
    ) {
      authAttemptedRef.current = false;
      onSuccess?.(provider.id);
      onClose();
    }
  }, [provider.authState, provider.id, onSuccess, onClose]);

  const handleStartLogin = (method: AuthMethod) => {
    authAttemptedRef.current = true;
    if (method.type === 'terminal') {
      setActiveTerminalMethod(method);
    } else {
      login({ providerId: provider.id, methodId: method.id });
    }
  };

  const handleCancel = () => {
    authAttemptedRef.current = false;
    setActiveTerminalMethod(null);
    cancelLogin(provider.id);
  };

  const handleTerminalSuccess = useCallback(() => {
    setActiveTerminalMethod(null);
  }, []);

  const handleSaveEnv = async () => {
    authAttemptedRef.current = true;
    setIsSavingEnv(true);
    try {
      await updateProviderConfigAsync({ providerId: provider.id, customEnv: localEnv });
      setLocalEnv({});
    } finally {
      setIsSavingEnv(false);
    }
  };

  const errorMessage =
    provider.authError?.message ??
    'Authentication failed. Please check your credentials and try again.';

  return (
    <div className="mt-3 flex flex-col gap-4 font-sans text-xs">
      {/* 1. Verifying State */}
      {isVerifying && !activeTerminalMethod && (
        <div className="border-border/40 bg-surface/30 flex flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center">
          <Loader2 className="text-accent h-6 w-6 animate-spin" />
          <div className="space-y-1">
            <p className="text-text-main text-xs font-semibold">Verifying connection...</p>
            <p className="text-text-muted text-[11px]">
              Agentctl is performing a handshake probe to verify credentials.
            </p>
          </div>
        </div>
      )}

      {/* 2. Embedded Terminal State */}
      {activeTerminalMethod && (
        <EmbeddedAuthTerminal
          providerId={provider.id}
          methodId={activeTerminalMethod.id}
          onSuccess={handleTerminalSuccess}
          onCancel={handleCancel}
        />
      )}

      {provider.authInteraction && (
        <BrowserAuthInteraction
          key={provider.authInteraction.id}
          providerId={provider.id}
          request={provider.authInteraction}
        />
      )}

      {/* 3. Authenticating (Agent Method) State */}
      {provider.authState === 'authenticating' &&
        !activeTerminalMethod &&
        !provider.authInteraction && (
          <div className="border-border/40 bg-surface/30 flex flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center">
            <Loader2 className="text-accent h-6 w-6 animate-spin" />
            <div className="space-y-1">
              <p className="text-text-main text-xs font-semibold">
                Waiting for agent authentication...
              </p>
              <p className="text-text-muted text-[11px]">
                Complete the prompt in your browser or agent window if prompted.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="border-border/50 text-text-muted hover:text-text-main hover:bg-surface-secondary mt-2 flex h-7 items-center rounded-lg border px-3 text-xs"
            >
              Cancel
            </button>
          </div>
        )}

      {/* 4. Error State */}
      {isError && !isAuthenticating && !isVerifying && (
        <div className="border-danger/30 bg-danger/10 flex flex-col gap-3 rounded-xl border p-3.5 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="text-danger mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-danger font-semibold">Authentication Error</p>
              <p className="text-text-muted text-[11px] break-words">{errorMessage}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="border-border/40 text-text-muted hover:text-text-main flex h-7 items-center rounded-lg border px-3 text-[11px]"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                authAttemptedRef.current = true;
                verifyProvider(provider.id);
              }}
              className="bg-accent text-brand-crust flex h-7 items-center rounded-lg px-3 text-[11px] font-semibold hover:opacity-90"
            >
              Retry Verification
            </button>
          </div>
        </div>
      )}

      {/* 5. Connected State */}
      {(isAuthenticated || isReadyWithoutAuth) && !isAuthenticating && !isVerifying && !isError && (
        <div className="border-border/40 bg-surface/30 flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <div className="bg-success/15 text-success flex h-7 w-7 items-center justify-center rounded-full">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-text-main font-semibold">
                {isAuthenticated ? 'Authenticated & Connected' : 'Connected'}
              </p>
              <p className="text-text-muted text-[11px]">
                {provider.lastVerifiedAt
                  ? `Last verified at ${new Date(provider.lastVerifiedAt).toLocaleTimeString()}`
                  : isAuthenticated
                    ? 'Credentials verified.'
                    : 'This provider does not require authentication.'}
              </p>
            </div>
          </div>

          <div className="border-border/20 flex items-center justify-between border-t pt-3">
            <button
              type="button"
              onClick={() => void verifyProvider(provider.id)}
              className="text-text-muted hover:text-text-main flex items-center gap-1.5 text-[11px]"
            >
              <RefreshCw className="h-3 w-3" />
              Re-verify
            </button>
            {provider.supportsLogout && isAuthenticated && (
              <button
                type="button"
                onClick={() => logoutProvider(provider.id)}
                disabled={isLoggingOut}
                className="text-danger hover:bg-danger/10 flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors"
              >
                <LogOut className="h-3 w-3" />
                {isLoggingOut ? 'Logging out...' : 'Log out'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 6. Method Selection State */}
      {!isAuthenticated && !isReadyWithoutAuth && !isAuthenticating && !isVerifying && (
        <div className="flex flex-col gap-2.5">
          {provider.authState === 'required' && provider.authError && (
            <div className="border-warning/25 bg-warning/10 text-text-muted flex items-start gap-2 rounded-lg border p-2.5 text-[11px]">
              <AlertCircle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{provider.authError.message}</span>
            </div>
          )}
          {authMethods.length === 0 ? (
            <div className="border-border/30 bg-surface/20 flex flex-col items-center justify-center gap-2 rounded-xl border p-5 text-center">
              <p className="text-text-muted text-xs">
                {envKeys.length > 0
                  ? 'This legacy provider reads credentials from environment variables.'
                  : 'No specific authentication methods advertised by this agent.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (envKeys.length > 0) {
                    setShowAdvancedEnv(true);
                  } else {
                    authAttemptedRef.current = true;
                    verifyProvider(provider.id);
                  }
                }}
                className="bg-accent text-brand-crust flex h-8 items-center rounded-lg px-4 text-xs font-semibold hover:opacity-90"
              >
                {envKeys.length > 0 ? 'Enter credentials' : 'Verify & Connect'}
              </button>
            </div>
          ) : (
            authMethods.map((method, idx) => (
              <button
                key={method.id}
                type="button"
                onClick={() => handleStartLogin(method)}
                className={`flex min-h-12 w-full items-center rounded-xl px-4 py-2 text-left text-xs font-medium transition-colors ${
                  idx === 0
                    ? 'bg-accent text-brand-crust font-semibold shadow hover:opacity-90 active:scale-[0.99]'
                    : 'border-border/50 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 border'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {method.type === 'terminal' ? (
                    <TerminalIcon className="h-4 w-4" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>
                      {method.type === 'terminal'
                        ? `Log in via Terminal (${method.name})`
                        : `Continue with ${method.name}`}
                    </span>
                    {method.description && (
                      <span className="text-[10px] font-normal opacity-75">
                        {method.description}
                      </span>
                    )}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* 7. Collapsible Advanced Environment Overrides */}
      <div className="border-border/20 border-t pt-3">
        <button
          type="button"
          onClick={() => setShowAdvancedEnv((prev) => !prev)}
          className="text-text-muted hover:text-text-main flex w-full items-center justify-between py-1 text-[11px] font-medium transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {showAdvancedEnv ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Environment overrides (Advanced / Legacy)
          </span>
          <span className="text-[10px] opacity-70">
            {Object.values(provider.customEnvConfigured).filter(Boolean).length > 0
              ? `${Object.values(provider.customEnvConfigured).filter(Boolean).length} configured`
              : 'Optional'}
          </span>
        </button>

        {showAdvancedEnv && (
          <div className="border-border/20 bg-surface/20 mt-2.5 space-y-3 rounded-lg border p-3">
            <p className="text-text-muted text-[11px] leading-relaxed">
              Modern ACP agents own their credentials directly. Use this section only to provide
              manual environment variable overrides for legacy providers. Overrides are stored in
              Agentctl's encrypted local credential vault.
            </p>

            {envKeys.length === 0 ? (
              <p className="text-text-muted/70 text-[11px] italic">
                No environment variables declared for this provider.
              </p>
            ) : (
              envKeys.map((key) => {
                const errorMsg = localEnv[key] ? validateApiKey(key, localEnv[key]) : null;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-baseline justify-between">
                      <label
                        htmlFor={`env-${key}`}
                        className="text-text-muted font-mono text-[11px] font-medium"
                      >
                        {key}
                      </label>
                      {errorMsg && (
                        <span className="text-danger flex items-center gap-1 text-[10px]">
                          <AlertCircle className="inline h-3 w-3" />
                          {errorMsg}
                        </span>
                      )}
                    </div>
                    <input
                      id={`env-${key}`}
                      type="password"
                      value={localEnv[key] ?? ''}
                      placeholder={
                        provider.customEnvConfigured[key]
                          ? 'Configured in credential vault (enter to replace)'
                          : `Enter ${key}...`
                      }
                      onChange={(e) => {
                        setLocalEnv({
                          ...localEnv,
                          [key]: e.target.value,
                        });
                      }}
                      className="border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/40 focus:border-accent/50 focus:ring-accent/40 h-8 w-full rounded-lg border px-3 font-mono text-xs outline-none focus:ring-1"
                    />
                  </div>
                );
              })
            )}

            {envKeys.length > 0 && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveEnv}
                  disabled={isSavingEnv || Object.keys(localEnv).length === 0}
                  className="bg-accent text-brand-crust flex h-7 items-center rounded-lg px-3 text-[11px] font-semibold hover:opacity-90 disabled:opacity-40"
                >
                  {isSavingEnv ? 'Saving...' : 'Save to Vault'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmbeddedAuthTerminal({
  providerId,
  methodId,
  onSuccess,
  onCancel,
}: {
  providerId: string;
  methodId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      theme: {
        background: '#181825',
        foreground: '#cdd6f4',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();

    // Connect WebSocket
    const baseUrl = getApiBaseUrl();
    const url = new URL(baseUrl || window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api/providers/${providerId}/auth/terminal/ws`;
    url.search = new URLSearchParams({ methodId }).toString();
    const capability = getDesktopCapability();
    const ws = capability
      ? new WebSocket(url.toString(), [`agentctl.desktop.${capability}`])
      : new WebSocket(url.toString());

    ws.onopen = () => {
      term.write('\r\n\x1b[1;34m● Initializing terminal authentication...\x1b[0m\r\n\r\n');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          data?: string;
          code?: number;
          error?: string;
        };
        if (msg.type === 'data' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          setExitCode(msg.code ?? 0);
          if (msg.code === 0) {
            term.write('\r\n\x1b[1;32m✓ Authentication succeeded! Verifying...\x1b[0m\r\n');
          } else {
            term.write(`\r\n\x1b[1;31m✗ Process exited with code ${msg.code}\x1b[0m\r\n`);
          }
        } else if (msg.type === 'authenticated') {
          term.write('\r\n\x1b[1;32m✓ Provider connected and verified.\x1b[0m\r\n');
          onSuccess();
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[1;31mError: ${msg.error}\x1b[0m\r\n`);
        }
      } catch {
        term.write(String(event.data));
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    return () => {
      ws.close();
      term.dispose();
    };
  }, [providerId, methodId, onSuccess]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-text-muted flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 font-medium">
          <TerminalIcon className="text-accent h-3.5 w-3.5" />
          Interactive Terminal Login
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-main flex items-center gap-1"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>

      <div
        ref={terminalRef}
        className="border-border/40 h-64 w-full overflow-hidden rounded-xl border bg-[#181825] p-2"
      />

      {exitCode !== null && exitCode !== 0 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-danger text-[11px]">Process exited with code {exitCode}</span>
          <button
            type="button"
            onClick={onCancel}
            className="border-border/40 text-text-muted hover:text-text-main rounded border px-2.5 py-1 text-[11px]"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
