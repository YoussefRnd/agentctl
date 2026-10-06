import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import {
  ProviderPickerTrigger,
  ThinkingEffortSelector,
  AgentPersonaSelector,
  AdvancedSettingsPopover,
} from './ProviderConfigurator';
import { SubmitButton } from './SessionController';

interface CommandBarToolbarProps {
  status: {
    isLoadingSession: boolean;
    isLoadingProviders: boolean;
  };
  picker: {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
  };
  activeProvider: ProviderDiscovery | undefined;
  providers: ProviderDiscovery[];
  propSelectedModelId: string | null | undefined;
  selectedProviderLabel: string;
  resolvedId: string | null;
  handleProviderSelect: (id: string, modelId?: string) => void;
  sessionId: string | null;
  sessionData: SessionWithCapabilities | null;
  setAgentPersona: (persona: string) => Promise<void>;
  handleSetConfigOption: (id: string, value: string) => Promise<void>;
  handleSubmit: () => void;
  onCancel: () => void;
  onOpenAuthModal?: () => void;
  flags: {
    isUpdatingAgentPersona: boolean;
    isUpdatingConfigOption: boolean;
    canSend: boolean;
    isRunning: boolean;
    isSubmitting?: boolean;
  };
}

export function CommandBarToolbar({
  status,
  picker,
  activeProvider,
  providers,
  propSelectedModelId,
  selectedProviderLabel,
  resolvedId,
  handleProviderSelect,
  sessionId,
  sessionData,
  setAgentPersona,
  handleSetConfigOption,
  handleSubmit,
  onCancel,
  onOpenAuthModal,
  flags: { isUpdatingAgentPersona, isUpdatingConfigOption, canSend, isRunning, isSubmitting },
}: CommandBarToolbarProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="no-scrollbar -my-1 flex min-w-0 items-center gap-1 overflow-x-auto py-1 sm:gap-1.5">
        <ProviderPickerTrigger
          isLoading={status.isLoadingSession || status.isLoadingProviders}
          isOpen={picker.isOpen}
          onOpenChange={picker.setIsOpen}
          activeProvider={activeProvider}
          providers={providers}
          selectedModelId={propSelectedModelId}
          selectedProviderLabel={selectedProviderLabel}
          resolvedId={resolvedId}
          handleProviderSelect={handleProviderSelect}
          sessionId={sessionId}
          onOpenAuthModal={onOpenAuthModal}
        />

        <ThinkingEffortSelector
          isLoading={status.isLoadingSession}
          sessionData={sessionData}
          handleSetConfigOption={handleSetConfigOption}
          isUpdating={isUpdatingConfigOption}
        />

        <AgentPersonaSelector
          isLoading={status.isLoadingSession}
          sessionData={sessionData}
          isUpdating={isUpdatingAgentPersona}
          setAgentPersona={setAgentPersona}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <AdvancedSettingsPopover isLoading={status.isLoadingSession} />
        <SubmitButton
          canSend={canSend}
          onSubmit={isRunning && !canSend ? onCancel : handleSubmit}
          isStop={isRunning && !canSend}
          isSubmitting={isSubmitting && !isRunning}
          sessionData={sessionData}
          isLoading={status.isLoadingSession}
        />
      </div>
    </div>
  );
}
