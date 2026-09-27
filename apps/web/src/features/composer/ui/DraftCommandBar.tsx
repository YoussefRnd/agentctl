import { useEffect, useState } from 'react';
import { resolveAgentFeatures, type ThinkingEffort, type SessionEventRow } from '@agentctl/shared';
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
  disabled,
  onSend,
}: {
  projectId: string;
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
  const modelOption = activeProvider?.configOptions?.find(
    (option) => option.id === 'model' || option.id === 'selectedModel',
  );
  const selectedModel =
    draft.selectedModel ??
    (typeof modelOption?.currentValue === 'string'
      ? modelOption.currentValue
      : modelOption?.options?.[0]?.value) ??
    'default';
  const modeOption = activeProvider?.configOptions?.find((option) => option.category === 'mode');
  const personas =
    modeOption?.options?.map((option) => ({ value: option.value, label: option.name })) ??
    activeProvider?.modes?.map((mode) => ({
      value: mode,
      label: mode.charAt(0).toUpperCase() + mode.slice(1),
    })) ??
    [];
  const thinkingOption = activeProvider?.configOptions?.find(
    (option) =>
      option.category === 'thought_level' ||
      ['thinking', 'thinking_effort', 'selectedThinkingEffort'].includes(option.id),
  );
  const canConfigureThinking = resolveAgentFeatures(activeProvider).configuration.options;
  const thinkingValue =
    draft.thinkingConfig?.value ??
    draft.selectedThinkingEffort ??
    (typeof thinkingOption?.currentValue === 'string'
      ? thinkingOption.currentValue
      : thinkingOption?.options?.[0]?.value);
  const selectedThinkingEffort: ThinkingEffort =
    thinkingValue === 'low' || thinkingValue === 'medium' || thinkingValue === 'high'
      ? thinkingValue
      : 'medium';
  const thinkingConfig =
    canConfigureThinking && thinkingOption && (draft.thinkingConfig || draft.selectedThinkingEffort)
      ? { id: thinkingOption.id, value: thinkingValue! }
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
    mode: draft.mode ?? (settings?.defaultToWorktree === false ? 'local' : 'worktree'),
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
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-1.5">
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
                  ? { ...thinkingOption, currentValue: thinkingValue ?? '' }
                  : undefined
              }
              disabled={!!isBusy || isLoadingProviders || isLoadingSettings}
              debounceMs={0}
              onChange={(value) =>
                updateDraft(projectId, {
                  thinkingConfig: { id: thinkingOption!.id, value },
                  selectedThinkingEffort:
                    value === 'low' || value === 'medium' || value === 'high' ? value : undefined,
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
            <CommandDropdown<'review' | 'auto_approve' | 'yolo'>
              value={selection.approvalMode ?? 'review'}
              disabled={isBusy}
              variant="toolbar"
              onChange={(approvalMode) => updateDraft(projectId, { approvalMode })}
              options={[
                { value: 'review', label: 'Supervised' },
                { value: 'auto_approve', label: 'Auto Approve' },
                { value: 'yolo', label: 'Unsupervised' },
              ]}
            />
            <CommandDropdown<'local' | 'worktree'>
              value={selection.mode}
              disabled={isBusy}
              variant="toolbar"
              onChange={(mode) => updateDraft(projectId, { mode })}
              options={[
                { value: 'local', label: 'Local' },
                { value: 'worktree', label: 'Worktree' },
              ]}
            />
          </div>
          <SubmitButton
            canSend={canSend}
            onSubmit={() => {
              void state.handleSubmit();
            }}
            sessionData={null}
            isLoading={false}
          />
        </div>
      </ComposerInput>
      <ProviderAuthDialog
        provider={activeProvider ?? null}
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />
    </div>
  );
}
