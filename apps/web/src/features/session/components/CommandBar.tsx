import { useState, useMemo } from 'react';
import { Info } from 'lucide-react';
import { getProviderEnvKeys, validateApiKey, type ProviderDiscovery } from '@agentctl/shared';
import { useProviders } from '../../../hooks/useProviders';
import { CommandBarToolbar } from './CommandBarToolbar';
import { CommandBarFooter } from './command-bar/WorkspaceStateReviewer';
import { useCommandBarState } from './useCommandBarState';
import { CommandInputComposer } from './command-bar/CommandInputComposer';

interface ControlBarProps {
  onSend: (val: string, attachmentIds?: string[]) => void;
  disabled?: boolean;
  selectedProviderId?: string | null;
  selectedModelId?: string | null;
  onProviderSelect?: (id: string, modelId?: string) => void;
  placeholder?: string;
  initialInput?: string;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

function InlineAuthPanel({
  activeProvider,
  sessionId,
}: {
  activeProvider: ProviderDiscovery;
  sessionId: string | null;
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
          // Success config toast is handled by useProviders hook
        },
      },
    );
  };

  const authMethods = activeProvider.authMethods;
  const hasAuthMethods = authMethods.length > 0;
  const hasEnvKeys = envKeys.length > 0;

  return (
    <div className="flex w-full flex-col gap-3.5 px-5 pt-4 pb-4 font-sans text-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="bg-accent/15 text-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <Info className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h4 className="text-text-main text-sm leading-none font-medium">
              Authenticate to {activeProvider.label}
            </h4>
            <p className="text-text-muted text-xs leading-normal">
              Choose one of the following authentication options:
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
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
              className={`flex h-8 items-center justify-center rounded-lg px-4 text-xs font-semibold transition-all disabled:opacity-30 ${
                idx === 0
                  ? 'bg-accent text-brand-crust hover:opacity-90 active:scale-[0.98]'
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
              className={`border-border/50 bg-surface-secondary/40 text-text-main hover:bg-surface-secondary/80 flex h-8 items-center justify-center rounded-lg border px-4 text-xs font-semibold transition-all disabled:opacity-30 ${
                !hasAuthMethods ? 'bg-accent text-brand-crust border-none hover:opacity-90' : ''
              }`}
            >
              API Key
            </button>
          )}
        </div>
      </div>

      {(showApiKeyInput || (!hasAuthMethods && hasEnvKeys)) && (
        <div className="border-border/20 flex max-w-md flex-col gap-3 border-t pt-3">
          {envKeys.map((key: string) => {
            const errorMsg = getKeyError(key);
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`inline-${key}`} className="text-text-muted label-3xs">
                    {key}
                  </label>
                  {errorMsg && <span className="text-danger caption-3xs">{errorMsg}</span>}
                </div>
                <input
                  id={`inline-${key}`}
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
                  className={`border-border/30 bg-surface/40 text-text-main placeholder:text-text-muted/30 focus:border-accent/40 focus:ring-accent/40 h-8 w-full rounded-lg border px-2.5 font-sans text-[11px] transition-all duration-200 outline-none focus:ring-1 ${
                    errorMsg ? 'border-danger/40 focus:border-danger/60 focus:ring-danger/40' : ''
                  }`}
                />
              </div>
            );
          })}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || envKeys.some((key: string) => getKeyError(key) !== null)}
              className="bg-accent text-brand-crust flex h-8 items-center justify-center rounded-lg px-5 text-center text-[10px] font-bold tracking-wider uppercase transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30"
            >
              {isUpdatingConfig ? 'Saving...' : 'Save API Key'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CommandBar({
  onSend,
  disabled,
  selectedProviderId: propSelectedProviderId,
  selectedModelId: propSelectedModelId,
  onProviderSelect,
  placeholder = 'Ask for follow-up changes or attach images',
  initialInput,
}: ControlBarProps) {
  const {
    sessionId,
    sessionData,
    branches,
    switchBranch,
    isSwitchingBranch,
    switchMode,
    isSwitchingMode,
    setApprovalMode,
    isUpdatingApprovalMode,
    setAgentPersona,
    isUpdatingAgentPersona,
    setSessionConfigOption,
    isUpdatingConfigOption,
    isLoadingSession,
    providers,
    isLoadingProviders,
    input,
    handleInputChange,
    activeCommandIndex,
    setActiveCommandIndex,
    isRunning,
    handleCancel,
    commandRefs,
    showSlashMenu,
    filteredCommands,
    matchingCommand,
    isPickerOpen,
    setIsPickerOpen,
    isFocused,
    setIsFocused,
    textareaRef,
    fileInputRef,
    attachments,
    removeAttachment,
    resolvedId,
    activeProvider,
    selectedProviderLabel,
    handleSubmit,
    handleProviderSelect,
    handleAttachClick,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    canSend,
    handleSelectCommand,
  } = useCommandBarState({
    onSend,
    disabled,
    propSelectedProviderId,
    onProviderSelect,
    initialInput,
  });

  const isUnauthenticated = activeProvider?.authState === 'needs_auth';

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileInputChange}
      />

      <form
        className="relative w-full"
        aria-label="Command interface"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <CommandInputComposer
          disabled={disabled}
          input={input}
          handleInputChange={handleInputChange}
          isFocused={isFocused}
          setIsFocused={setIsFocused}
          handleSubmit={handleSubmit}
          handlePaste={handlePaste}
          handleDrop={handleDrop}
          handleAttachClick={handleAttachClick}
          textareaRef={textareaRef}
          showSlashMenu={showSlashMenu}
          filteredCommands={filteredCommands}
          activeCommandIndex={activeCommandIndex}
          setActiveCommandIndex={setActiveCommandIndex}
          commandRefs={commandRefs}
          handleSelectCommand={handleSelectCommand}
          matchingCommand={matchingCommand}
          attachments={attachments}
          removeAttachment={removeAttachment}
          placeholder={placeholder}
          status={sessionData?.session.status}
          isUnauthenticated={isUnauthenticated}
          authPanelContent={
            activeProvider && (
              <InlineAuthPanel activeProvider={activeProvider} sessionId={sessionId} />
            )
          }
        >
          <CommandBarToolbar
            status={{
              isLoadingSession,
              isLoadingProviders,
              isUpdatingApprovalMode,
            }}
            picker={{
              isOpen: isPickerOpen,
              setIsOpen: setIsPickerOpen,
            }}
            activeProvider={activeProvider}
            providers={providers}
            propSelectedModelId={propSelectedModelId}
            selectedProviderLabel={selectedProviderLabel}
            resolvedId={resolvedId}
            handleProviderSelect={handleProviderSelect}
            sessionId={sessionId}
            sessionData={sessionData}
            setApprovalMode={setApprovalMode}
            setAgentPersona={setAgentPersona}
            isUpdatingAgentPersona={isUpdatingAgentPersona}
            handleSetConfigOption={setSessionConfigOption}
            isUpdatingConfigOption={isUpdatingConfigOption}
            canSend={canSend}
            handleSubmit={handleSubmit}
            isRunning={isRunning}
            onCancel={handleCancel}
          />
        </CommandInputComposer>
      </form>
      <CommandBarFooter
        isLoadingSession={isLoadingSession}
        sessionData={sessionData}
        isSwitchingMode={isSwitchingMode}
        switchMode={switchMode}
        isSwitchingBranch={isSwitchingBranch}
        switchBranch={switchBranch}
        branches={branches}
      />
    </div>
  );
}
