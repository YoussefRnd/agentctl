import {
  ProviderAuthBodyLayout,
  AuthCancelLayout,
  providerAuthConnectionCopy,
  AuthMethodsLayout,
  AuthEmptyActionLayout,
  providerAuthMethods,
  AuthStatusLayout,
  AuthMethodLayout,
  AuthEmptyMethodsLayout,
  AuthConnectionLayout,
  AuthEnvironmentLayout,
} from './ProviderAuthBodyLayouts';
import type { Dispatch, SetStateAction, ReactNode } from 'react';
import {
  Terminal as TerminalIcon,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogIn,
  ChevronDown,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { Spinner } from '@agentctl/ui';
import {
  getProviderEnvKeys,
  validateApiKey,
  type ProviderDiscovery,
  type AuthMethod,
} from '@agentctl/shared';

export interface ProviderAuthPresentationProps {
  provider: ProviderDiscovery;
  activeTerminalMethod?: AuthMethod | null;
  terminal?: ReactNode;
  interaction?: ReactNode;
  showAdvancedEnv: boolean;
  setShowAdvancedEnv: Dispatch<SetStateAction<boolean>>;
  localEnv: Record<string, string>;
  setLocalEnv: Dispatch<SetStateAction<Record<string, string>>>;
  isSavingEnv?: boolean;
  isLoggingOut?: boolean;
  handleCancel: () => void;
  handleStartLogin: (method: AuthMethod) => void;
  handleSaveEnv: () => Promise<void>;
  verifyProvider: (id: string) => void;
  logoutProvider: (id: string) => void;
  onAttemptAuth: () => void;
  onClose: () => void;
}
export function ProviderAuthPresentation({
  provider,
  activeTerminalMethod,
  terminal,
  interaction,
  showAdvancedEnv,
  setShowAdvancedEnv,
  localEnv,
  setLocalEnv,
  isSavingEnv = false,
  isLoggingOut = false,
  handleCancel,
  handleStartLogin,
  handleSaveEnv,
  verifyProvider,
  logoutProvider,
  onAttemptAuth,
  onClose,
}: ProviderAuthPresentationProps) {
  const authMethods = providerAuthMethods(provider);
  const envKeys = getProviderEnvKeys(provider);
  const isAuthenticating = provider.authState === 'authenticating' || !!activeTerminalMethod;
  const isVerifying = provider.authState === 'verifying';
  const isAuthenticated = provider.authState === 'authenticated';
  const isReadyWithoutAuth = provider.authState === 'not_required';
  const isError = provider.authState === 'error' || provider.connectionState === 'error';
  const errorMessage =
    provider.authError?.message ??
    'Authentication failed. Please check your credentials and try again.';
  return (
    <ProviderAuthBodyLayout>
      {/* 1. Verifying State */}
      {isVerifying && !activeTerminalMethod && (
        <AuthStatusLayout
          phase="verifying"
          announce
          icon={<Spinner aria-hidden="true" className="text-accent icon-prominent" />}
        />
      )}

      {/* 2. Embedded Terminal State */}
      {terminal}
      {interaction}

      {/* 3. Authenticating (Agent Method) State */}
      {provider.authState === 'authenticating' &&
        !activeTerminalMethod &&
        !provider.authInteraction && (
          <AuthStatusLayout
            phase="authenticating"
            announce
            icon={<Spinner aria-hidden="true" className="text-accent icon-prominent" />}
            actions={<AuthCancelLayout onSelect={handleCancel}>Cancel</AuthCancelLayout>}
          />
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
                onAttemptAuth();
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
        <AuthConnectionLayout
          icon={
            <>
              <CheckCircle2 className="h-4 w-4" />
            </>
          }
          title={providerAuthConnectionCopy(provider).title}
          description={providerAuthConnectionCopy(provider).description}
          actions={
            <>
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
            </>
          }
        />
      )}

      {/* 6. Method Selection State */}
      {!isAuthenticated && !isReadyWithoutAuth && !isAuthenticating && !isVerifying && (
        <AuthMethodsLayout>
          {provider.authState === 'required' && provider.authError && (
            <div className="border-warning/25 bg-warning/10 text-text-muted flex items-start gap-2 rounded-lg border p-2.5 text-[11px]">
              <AlertCircle className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{provider.authError.message}</span>
            </div>
          )}
          {authMethods.length === 0 ? (
            <AuthEmptyMethodsLayout
              description={
                <>
                  {envKeys.length > 0
                    ? 'This legacy provider reads credentials from environment variables.'
                    : 'No specific authentication methods advertised by this agent.'}
                </>
              }
              action={
                <AuthEmptyActionLayout
                  onSelect={() => {
                    if (envKeys.length > 0) {
                      setShowAdvancedEnv(true);
                    } else {
                      onAttemptAuth();
                      verifyProvider(provider.id);
                    }
                  }}
                >
                  {envKeys.length > 0 ? 'Enter credentials' : 'Verify & Connect'}
                </AuthEmptyActionLayout>
              }
            />
          ) : (
            authMethods.map((method, idx) => (
              <AuthMethodLayout
                key={method.id}
                primary={idx === 0}
                onSelect={() => handleStartLogin(method)}
                icon={
                  <>
                    {method.type === 'terminal' ? (
                      <TerminalIcon className="h-4 w-4" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                  </>
                }
                title={
                  <>
                    {method.type === 'terminal'
                      ? `Log in via Terminal (${method.name})`
                      : `Continue with ${method.name}`}
                  </>
                }
                description={method.description}
              />
            ))
          )}
        </AuthMethodsLayout>
      )}

      {/* 7. Collapsible Advanced Environment Overrides */}
      <AuthEnvironmentLayout
        onToggle={() => setShowAdvancedEnv((prev) => !prev)}
        heading={
          <>
            {showAdvancedEnv ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Environment overrides (Advanced / Legacy)
          </>
        }
        summary={
          <>
            {Object.values(provider.customEnvConfigured ?? {}).filter(Boolean).length > 0
              ? `${Object.values(provider.customEnvConfigured ?? {}).filter(Boolean).length} configured`
              : 'Optional'}
          </>
        }
      >
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
                        provider.customEnvConfigured?.[key]
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
      </AuthEnvironmentLayout>
    </ProviderAuthBodyLayout>
  );
}
