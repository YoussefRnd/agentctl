import {
  approvalBehaviorOptions,
  DEFAULT_AGENT_MODEL,
  resolveThinkingEffort,
} from '@agentctl/shared';
import { useEffect, useState } from 'react';
import { Monitor, Shield } from 'lucide-react';
import {
  findAgentConfigOption,
  resolveAgentFeatures,
  type ThinkingEffort,
  type SessionEventRow,
} from '@agentctl/shared';
import { useProviders, ProviderAuthDialog } from '@/features/providers';
import { useSettings } from '@/features/settings';
import { useComposerState } from '../model/useComposerState';
import { useDraftStore, EMPTY_HOME_DRAFT } from '../model/useDraftStore';
import type { HomeSessionSelection } from '../model/useHomeSessionStart';
import { ComposerInput } from './ComposerInput';
import { ProviderPickerTrigger } from './ProviderConfigurator';
import { CommandDropdown } from './CommandDropdown';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { SubmitButton } from './SessionController';

const EMPTY_EVENTS: SessionEventRow[] = [];
export function DraftCommandBar({
  projectId,
  canUseWorktree,
  disabled,
  onSend,
}: {
  projectId: string;
  canUseWorktree: boolean;
  disabled?: boolean;
  onSend: (text: string, files: File[], selection: HomeSessionSelection) => Promise<boolean>;
}) {
  const { providers, isLoadingProviders } = useProviders(null);
  const { settings, isLoading: isLoadingSettings } = useSettings();
  const draft = useDraftStore((s) => s.homeDrafts[projectId] ?? EMPTY_HOME_DRAFT);
  const updateDraft = useDraftStore((s) => s.updateHomeDraft);
  const [initialDraft] = useState(draft);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const installed = providers.filter((provider) => provider.installState !== 'not_installed');
  const activeProvider =
    installed.find(
      (provider) => provider.id === (draft.providerId ?? settings?.defaultProviderId),
    ) ??
    installed.find((provider) => provider.status === 'ready') ??
    installed[0];
  const modelOption = findAgentConfigOption(activeProvider?.configOptions, 'model');
  const selectedModel =
    draft.selectedModel ??
    activeProvider?.defaultModel ??
    (typeof modelOption?.currentValue === 'string'
      ? modelOption.currentValue
      : modelOption?.options?.[0]?.value) ??
    DEFAULT_AGENT_MODEL;
  const modeOption = findAgentConfigOption(activeProvider?.configOptions, 'mode');
  const personas =
    modeOption?.options?.map((option) => ({ value: option.value, label: option.name })) ??
    activeProvider?.modes?.map((mode) => ({
      value: mode,
      label: mode.charAt(0).toUpperCase() + mode.slice(1),
    })) ??
    [];
  const thinkingOption = findAgentConfigOption(activeProvider?.configOptions, 'thought_level');
  const canConfigureThinking = resolveAgentFeatures(activeProvider).configuration.options;
  const thinkingValue =
    draft.thinkingConfig?.value ??
    draft.selectedThinkingEffort ??
    activeProvider?.defaultThinkingEffort ??
    (typeof thinkingOption?.currentValue === 'string'
      ? thinkingOption.currentValue
      : thinkingOption?.options?.[0]?.value);
  const selectedThinkingEffort: ThinkingEffort = resolveThinkingEffort(
    thinkingOption,
    thinkingValue,
  );
  const thinkingConfig =
    canConfigureThinking &&
    thinkingOption &&
    selectedThinkingEffort !== null &&
    (draft.thinkingConfig || draft.selectedThinkingEffort)
      ? { id: thinkingOption.id, value: selectedThinkingEffort }
      : undefined;
  const selection: HomeSessionSelection = {
    providerId: activeProvider?.id ?? '',
    ...(draft.taskSlug ? { taskSlug: draft.taskSlug } : {}),
    selectedModel,
    selectedThinkingEffort,
    ...(thinkingConfig ? { thinkingConfig } : {}),
    agentPersona:
      draft.agentPersona ??
      (typeof modeOption?.currentValue === 'string' ? modeOption.currentValue : personas[0]?.value),
    approvalMode: draft.approvalMode ?? 'review',
    mode: canUseWorktree
      ? (draft.mode ?? (settings?.defaultToWorktree === false ? 'local' : 'worktree'))
      : 'local',
  };
  const state = useComposerState({
    sessionId: '',
    projectId,
    draftKey: `home:${projectId}`,
    sessionData: null,
    events: EMPTY_EVENTS,
    providers,
    selectedProviderId: selection.providerId,
    selectedModelId: selectedModel,
    disabled,
    initialFiles: initialDraft.files,
    initialContexts: initialDraft.contexts,
    onProviderSelect: (providerId, modelId) =>
      updateDraft(projectId, {
        providerId,
        selectedModel: modelId,
        selectedThinkingEffort: undefined,
        thinkingConfig: undefined,
        agentPersona: undefined,
      }),
    onSend: (text, _ids, files = []) => {
      if (
        activeProvider?.status !== 'ready' ||
        isLoadingProviders ||
        isLoadingSettings ||
        (files.length > 0 && !resolveAgentFeatures(activeProvider).prompts.image)
      )
        return false;
      return onSend(text, files, selection);
    },
  });
  useEffect(() => {
    updateDraft(projectId, {
      files: state.attachments.map((attachment) => attachment.file),
      contexts: state.contextAutocomplete.attachedContexts,
    });
  }, [projectId, state.attachments, state.contextAutocomplete.attachedContexts, updateDraft]);
  const isBusy = disabled || state.isSubmitting;
  const canSend =
    state.canSend &&
    !isLoadingProviders &&
    !isLoadingSettings &&
    activeProvider?.status === 'ready' &&
    (state.attachments.length === 0 || state.supportsImageAttachments);
  return (
    <div className="flex w-full flex-col">
      <ComposerInput state={state} variant="hero" disabled={isBusy}>
        <div className="flex min-w-0 items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="no-scrollbar -my-1 flex min-w-0 items-center gap-1 overflow-x-auto py-1 sm:gap-1.5">
            <ProviderPickerTrigger
              isLoading={isLoadingProviders || !!isBusy}
              isOpen={state.isPickerOpen}
              onOpenChange={state.setIsPickerOpen}
              activeProvider={activeProvider}
              providers={state.providers}
              selectedModelId={selectedModel}
              selectedProviderLabel={state.selectedProviderLabel}
              resolvedId={selection.providerId}
              handleProviderSelect={state.handleProviderSelect}
              sessionId={null}
              onOpenAuthModal={() => setIsAuthOpen(true)}
            />
            <ThinkingEffortControl
              key={`${selection.providerId}:${selectedModel}:${thinkingOption?.id}`}
              option={
                canConfigureThinking && thinkingOption
                  ? {
                      ...thinkingOption,
                      currentValue: selectedThinkingEffort ?? thinkingOption.currentValue,
                    }
                  : undefined
              }
              disabled={!!isBusy || isLoadingProviders || isLoadingSettings}
              debounceMs={0}
              onChange={(value) =>
                updateDraft(projectId, {
                  thinkingConfig: { id: thinkingOption!.id, value },
                  selectedThinkingEffort: value,
                })
              }
            />
            {personas.length > 0 && (
              <CommandDropdown
                value={selection.agentPersona ?? personas[0].value}
                disabled={isBusy}
                variant="toolbar"
                onChange={(agentPersona) => updateDraft(projectId, { agentPersona })}
                options={personas}
              />
            )}
          </div>
          <SubmitButton
            canSend={canSend}
            onSubmit={() => {
              void state.handleSubmit();
            }}
            sessionData={null}
            isLoading={false}
            isSubmitting={!!isBusy}
          />
        </div>
      </ComposerInput>
      {isBusy && (
        <p role="status" aria-live="polite" className="text-text-muted mt-3 px-2 text-sm">
          Creating your session… Preparing the workspace and sending your message.
        </p>
      )}
      <div className="text-text-muted/80 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-2 text-[11px] font-medium">
        <CommandDropdown<'local' | 'worktree'>
          value={selection.mode}
          disabled={isBusy}
          onChange={(mode) => updateDraft(projectId, { mode })}
          icon={<Monitor className="h-3.5 w-3.5" />}
          options={[
            { value: 'local', label: 'Local' },
            ...(canUseWorktree ? [{ value: 'worktree' as const, label: 'Worktree' }] : []),
          ]}
        />
        <CommandDropdown<'review' | 'auto_approve' | 'yolo'>
          value={selection.approvalMode ?? 'review'}
          disabled={isBusy}
          title="Approval behavior"
          icon={<Shield className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          onChange={(approvalMode) => updateDraft(projectId, { approvalMode })}
          options={approvalBehaviorOptions}
        />
      </div>
      <ProviderAuthDialog
        provider={activeProvider ?? null}
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />
    </div>
  );
}
