import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import {
  ProviderPickerTrigger,
  ThinkingEffortSelector,
  AgentPersonaSelector,
  AdvancedSettingsPopover,
} from './ProviderConfigurator';
import { ApprovalModeSelector, SubmitButton } from './SessionController';

interface CommandBarToolbarProps {
  status: {
    isLoadingSession: boolean;
    isLoadingProviders: boolean;
    isUpdatingApprovalMode: boolean;
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
  setApprovalMode: (approvalMode: 'review' | 'auto_approve' | 'yolo') => Promise<void>;
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
  setApprovalMode,
  setAgentPersona,
  handleSetConfigOption,
  handleSubmit,
  onCancel,
  onOpenAuthModal,
  flags: { isUpdatingAgentPersona, isUpdatingConfigOption, canSend, isRunning },
}: CommandBarToolbarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-1.5">
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

        <ApprovalModeSelector
          isLoading={status.isLoadingSession}
          sessionData={sessionData}
          isUpdating={status.isUpdatingApprovalMode}
          setApprovalMode={async (mode) => {
            await setApprovalMode(mode);
          }}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <AdvancedSettingsPopover isLoading={status.isLoadingSession} />
        <SubmitButton
          canSend={canSend}
          onSubmit={isRunning && !canSend ? onCancel : handleSubmit}
          isStop={isRunning && !canSend}
          sessionData={sessionData}
          isLoading={status.isLoadingSession}
        />
      </div>
    </div>
  );
}
