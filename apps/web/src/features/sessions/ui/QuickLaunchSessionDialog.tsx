import { NativeSessionImport } from './NativeSessionImport';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Select,
  type SelectOption,
} from '@agentctl/ui';
import {
  DEFAULT_AGENT_MODEL,
  findAgentConfigOption,
  resolveThinkingEffort,
  type SessionMode,
  type ThinkingEffort,
} from '@agentctl/shared';
import { useDraftStore } from '@/features/composer';
import { useProviders } from '@/features/providers';
import { useSettings } from '@/features/settings';

interface QuickLaunchSessionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  defaultMode?: SessionMode;
  allowWorktree?: boolean;
  initialProviderId?: string;
}

export function QuickLaunchSessionDialog({
  open,
  onClose,
  projectId,
  projectName,
  defaultMode,
  allowWorktree = true,
  initialProviderId,
}: QuickLaunchSessionDialogProps) {
  const navigate = useNavigate();
  const { providers } = useProviders(null);
  const { settings } = useSettings();

  const installedProviders = useMemo(
    () => providers.filter((p) => p.installState !== 'not_installed'),
    [providers],
  );

  const effectiveDefaultMode: SessionMode = allowWorktree
    ? (defaultMode ?? (settings?.defaultToWorktree === false ? 'local' : 'worktree'))
    : 'local';

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_AGENT_MODEL);
  const [selectedThinkingEffort, setSelectedThinkingEffort] = useState<ThinkingEffort>(null);
  const [selectedMode, setSelectedMode] = useState<SessionMode>(effectiveDefaultMode);
  const [taskSlug, setTaskSlug] = useState<string>('');
  const [showNativeSessions, setShowNativeSessions] = useState(false);

  // Initialize selection when dialog opens
  useEffect(() => {
    if (open) {
      setTaskSlug('');
      setShowNativeSessions(false);
      setSelectedMode(effectiveDefaultMode);

      const candidateProviderId =
        initialProviderId ||
        settings?.defaultProviderId ||
        installedProviders[0]?.id ||
        providers[0]?.id ||
        '';

      setSelectedProviderId(candidateProviderId);
    }
  }, [
    open,
    initialProviderId,
    settings?.defaultProviderId,
    installedProviders,
    providers,
    effectiveDefaultMode,
  ]);

  const activeProvider = useMemo(() => {
    return (
      installedProviders.find((p) => p.id === selectedProviderId) ??
      providers.find((p) => p.id === selectedProviderId) ??
      null
    );
  }, [installedProviders, providers, selectedProviderId]);

  const thinkingOption = findAgentConfigOption(activeProvider?.configOptions, 'thought_level');
  const thinkingOptions: SelectOption[] =
    thinkingOption?.options?.map((option) => ({ value: option.value, label: option.name })) ?? [];

  useEffect(() => {
    setSelectedModel(activeProvider?.defaultModel ?? DEFAULT_AGENT_MODEL);
    setSelectedThinkingEffort(
      resolveThinkingEffort(thinkingOption, undefined, activeProvider?.defaultThinkingEffort),
    );
  }, [
    selectedProviderId,
    activeProvider?.defaultModel,
    activeProvider?.defaultThinkingEffort,
    thinkingOption,
  ]);

  // Extract model options for active provider
  const modelOptions = useMemo<SelectOption[]>(() => {
    if (!activeProvider) return [{ label: 'Default Model', value: DEFAULT_AGENT_MODEL }];
    const modelConfig = findAgentConfigOption(activeProvider?.configOptions, 'model');
    if (modelConfig?.options && modelConfig.options.length > 0) {
      return modelConfig.options.map((opt) => ({
        label: opt.name || opt.value,
        value: opt.value,
      }));
    }
    return [{ label: 'Default Model', value: DEFAULT_AGENT_MODEL }];
  }, [activeProvider]);

  // Sync selected model when provider changes
  useEffect(() => {
    if (modelOptions.length > 0) {
      const exists = modelOptions.some((m) => m.value === selectedModel);
      if (!exists) {
        setSelectedModel(modelOptions[0]?.value ?? DEFAULT_AGENT_MODEL);
      }
    }
  }, [modelOptions, selectedModel]);

  const providerSelectOptions = useMemo<SelectOption[]>(() => {
    const list = installedProviders.length > 0 ? installedProviders : providers;
    return list.map((p) => ({
      label: p.label || p.id,
      value: p.id,
    }));
  }, [installedProviders, providers]);

  const handleLaunch = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    useDraftStore.getState().updateHomeDraft(projectId, {
      providerId: selectedProviderId || undefined,
      selectedModel,
      selectedThinkingEffort,
      thinkingConfig: undefined,
      mode: selectedMode,
      taskSlug: taskSlug.trim() || undefined,
      agentPersona: undefined,
    });
    onClose();
    void navigate(`/?project=${encodeURIComponent(projectId)}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent showCloseButton className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
          <DialogDescription>
            Configure environment for{' '}
            <span className="text-text-main font-semibold">{projectName}</span>
          </DialogDescription>
        </DialogHeader>

        {activeProvider?.features?.sessions?.list && (
          <div className="mt-4 space-y-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowNativeSessions((value) => !value)}
            >
              Import existing agent session
            </Button>
            {showNativeSessions && (
              <NativeSessionImport
                key={selectedProviderId}
                providerId={selectedProviderId}
                projectId={projectId}
                onImported={(sessionId) => {
                  onClose();
                  void navigate(`/sessions/${sessionId}`);
                }}
              />
            )}
          </div>
        )}
        <form onSubmit={handleLaunch} className="mt-4 space-y-4">
          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
              Agent Provider
            </label>
            <Select
              options={providerSelectOptions}
              value={selectedProviderId}
              onChange={setSelectedProviderId}
              placeholder="Select Provider"
            />
          </div>

          {/* Model & Thinking Effort */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
                Model
              </label>
              <Select
                options={modelOptions}
                value={selectedModel}
                onChange={setSelectedModel}
                placeholder="Select Model"
              />
            </div>

            {thinkingOptions.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
                  Thinking Effort
                </label>
                <Select
                  options={thinkingOptions}
                  value={selectedThinkingEffort ?? ''}
                  onChange={(v) => {
                    setSelectedThinkingEffort(v);
                  }}
                  placeholder="Thinking Effort"
                />
              </div>
            )}
          </div>

          {/* Workspace Mode */}
          <div className="space-y-1.5">
            <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
              Workspace Mode
            </label>
            <div className="border-border/40 bg-surface/40 flex w-full gap-1 rounded-lg border p-1">
              {[
                ...(allowWorktree
                  ? [{ mode: 'worktree' as const, label: 'Worktree (Branch)' }]
                  : []),
                { mode: 'local' as const, label: 'Local (In-place)' },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setSelectedMode(mode);
                  }}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    selectedMode === mode
                      ? 'bg-accent text-brand-crust shadow-sm'
                      : 'text-text-muted hover:text-text-main hover:bg-surface/60'
                  }`}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Optional Task Slug */}
          <div className="flex flex-col space-y-1.5">
            <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
              Task Name (Optional)
            </label>
            <Input
              type="text"
              placeholder="e.g. fix-login-issue"
              value={taskSlug}
              onChange={(e) => {
                setTaskSlug(e.target.value);
              }}
              className="border-border/50 bg-surface/40 focus:border-accent/30 focus:ring-accent/20 placeholder:text-text-muted/40 h-9 w-full min-w-0 rounded-md px-3 font-mono text-xs transition-colors"
            />
          </div>

          <DialogFooter className="mt-6 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" size="sm" className="font-semibold">
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
