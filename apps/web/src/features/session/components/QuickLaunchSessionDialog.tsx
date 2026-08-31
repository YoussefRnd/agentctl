import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
import { Loader2 } from 'lucide-react';
import type { SessionMode, ThinkingEffort } from '@agentctl/shared';
import { createProjectSession } from '@agentctl/api-client';
import { useProviders } from '../../../hooks/useProviders';
import { useSettings } from '../../../hooks/useSettings';

interface QuickLaunchSessionDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  defaultMode?: SessionMode;
  initialProviderId?: string;
}

export function QuickLaunchSessionDialog({
  open,
  onClose,
  projectId,
  projectName,
  defaultMode = 'worktree',
  initialProviderId,
}: QuickLaunchSessionDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { providers } = useProviders(null);
  const { settings } = useSettings();

  const installedProviders = useMemo(
    () => providers.filter((p) => p.installState !== 'not_installed'),
    [providers],
  );

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('default');
  const [selectedThinkingEffort, setSelectedThinkingEffort] = useState<ThinkingEffort>('medium');
  const [selectedMode, setSelectedMode] = useState<SessionMode>(defaultMode);
  const [taskSlug, setTaskSlug] = useState<string>('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize selection when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      setTaskSlug('');
      setSelectedMode(defaultMode);

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
    defaultMode,
  ]);

  const activeProvider = useMemo(() => {
    return (
      installedProviders.find((p) => p.id === selectedProviderId) ??
      providers.find((p) => p.id === selectedProviderId) ??
      null
    );
  }, [installedProviders, providers, selectedProviderId]);

  // Extract model options for active provider
  const modelOptions = useMemo<SelectOption[]>(() => {
    if (!activeProvider) return [{ label: 'Default Model', value: 'default' }];
    const modelConfig = activeProvider.configOptions?.find(
      (opt) => opt.id === 'model' || opt.id === 'selectedModel',
    );
    if (modelConfig?.options && modelConfig.options.length > 0) {
      return modelConfig.options.map((opt) => ({
        label: opt.name || opt.value,
        value: opt.value,
      }));
    }
    return [{ label: 'Default Model', value: 'default' }];
  }, [activeProvider]);

  const thinkingOptions = useMemo<SelectOption[]>(
    () => [
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
    ],
    [],
  );

  // Sync selected model when provider changes
  useEffect(() => {
    if (modelOptions.length > 0) {
      const exists = modelOptions.some((m) => m.value === selectedModel);
      if (!exists) {
        setSelectedModel(modelOptions[0]?.value ?? 'default');
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

  const handleLaunch = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    setIsLaunching(true);
    setError(null);

    try {
      const session = await createProjectSession(
        projectId,
        selectedMode,
        selectedProviderId || undefined,
      );

      if (session?.id) {
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        onClose();
        void navigate(`/sessions/${session.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to launch session';
      setError(msg);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isLaunching) onClose();
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

        <form onSubmit={handleLaunch} className="mt-4 space-y-4">
          {error && (
            <div className="bg-danger/10 border-danger/20 text-danger rounded-lg border p-2.5 text-xs">
              {error}
            </div>
          )}

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
          <div className="grid grid-cols-2 gap-3">
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

            <div className="space-y-1.5">
              <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
                Thinking Effort
              </label>
              <Select
                options={thinkingOptions}
                value={selectedThinkingEffort}
                onChange={(v) => {
                  setSelectedThinkingEffort(v as ThinkingEffort);
                }}
                placeholder="Thinking Effort"
              />
            </div>
          </div>

          {/* Workspace Mode */}
          <div className="space-y-1.5">
            <label className="text-text-muted text-[11px] font-bold tracking-wider uppercase">
              Workspace Mode
            </label>
            <div className="border-border/40 bg-surface/40 flex w-full gap-1 rounded-xl border p-1">
              {[
                { mode: 'worktree' as const, label: 'Worktree (Branch)' },
                { mode: 'local' as const, label: 'Local (In-place)' },
              ].map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setSelectedMode(mode);
                  }}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg py-1.5 text-xs font-semibold transition-colors ${
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
              className="border-border/50 bg-surface/40 focus:border-accent/30 focus:ring-accent/20 placeholder:text-text-muted/40 h-9 w-full rounded-xl px-3 font-mono text-xs transition-colors"
            />
          </div>

          <DialogFooter className="mt-6 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isLaunching}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="solid"
              size="sm"
              disabled={isLaunching}
              className="font-semibold"
            >
              {isLaunching ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Launching...
                </span>
              ) : (
                'Launch Session'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
