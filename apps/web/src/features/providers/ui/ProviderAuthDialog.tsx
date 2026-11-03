import { ProviderAuthPresentation } from './ProviderAuthPresentation';
import { providerAuthMethods } from './ProviderAuthBodyLayouts';
import { BrowserAuthInteraction } from './BrowserAuthInteraction';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { getProviderEnvKeys, type ProviderDiscovery, type AuthMethod } from '@agentctl/shared';
import { EmbeddedAuthTerminal } from './EmbeddedAuthTerminal';
import { useProviders } from '../api/useProviders.js';

export interface ProviderAuthDialogProps {
  provider: ProviderDiscovery | null;
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string | null;
  onSuccess?: (providerId: string) => void;
}

export function ProviderAuthDialogContent({
  provider,
  isOpen,
  onClose,
  sessionId = null,
  onSuccess,
}: ProviderAuthDialogProps) {
  if (!isOpen || !provider) return null;
  return (
    <ProviderAuthDialogBody
      key={provider.id}
      provider={provider}
      sessionId={sessionId}
      onClose={onClose}
      onSuccess={onSuccess}
    />
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

  const authMethods = useMemo(() => providerAuthMethods(provider), [provider]);

  const envKeys = useMemo(() => {
    return getProviderEnvKeys(provider);
  }, [provider]);

  useEffect(() => {
    if (authMethods.length === 0 && envKeys.length > 0) {
      setShowAdvancedEnv(true);
    }
  }, [authMethods.length, envKeys.length]);

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

  return (
    <ProviderAuthPresentation
      provider={provider}
      activeTerminalMethod={activeTerminalMethod}
      showAdvancedEnv={showAdvancedEnv}
      setShowAdvancedEnv={setShowAdvancedEnv}
      localEnv={localEnv}
      setLocalEnv={setLocalEnv}
      isSavingEnv={isSavingEnv}
      isLoggingOut={isLoggingOut}
      handleCancel={handleCancel}
      handleStartLogin={handleStartLogin}
      handleSaveEnv={handleSaveEnv}
      verifyProvider={verifyProvider}
      logoutProvider={logoutProvider}
      onAttemptAuth={() => {
        authAttemptedRef.current = true;
      }}
      onClose={onClose}
      terminal={
        activeTerminalMethod ? (
          <EmbeddedAuthTerminal
            providerId={provider.id}
            methodId={activeTerminalMethod.id}
            onSuccess={handleTerminalSuccess}
            onCancel={handleCancel}
          />
        ) : undefined
      }
      interaction={
        provider.authInteraction ? (
          <BrowserAuthInteraction
            key={provider.authInteraction.id}
            providerId={provider.id}
            request={provider.authInteraction}
          />
        ) : undefined
      }
    />
  );
}
