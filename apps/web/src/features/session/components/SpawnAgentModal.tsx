import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useSession } from '../../../contexts/SessionContext';
import { useProviders } from '../../../hooks/useProviders';
import { spawnParallelAgent } from '@agentctl/api-client';
import { Button, GlassPanel, Dropdown } from '@agentctl/ui';
import { Bot, Sparkles, X, Loader2, GitBranch, ChevronDown, Check } from 'lucide-react';
import { toast } from 'sonner';

interface SpawnAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function SpawnAgentModal({ isOpen, onClose, onSuccess }: SpawnAgentModalProps) {
  const { sessionId, sessionData } = useSession();
  const { providers } = useProviders(sessionId);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isSpawning, setIsSpawning] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Filter only installed / available providers
  const installedProviders = useMemo(() => {
    return providers.filter((p) => p.installState !== 'not_installed');
  }, [providers]);

  // Focus prompt on open
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        promptRef.current?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [isOpen]);

  const effectiveProviderId =
    selectedProvider ||
    sessionData?.session.selectedProvider ||
    (installedProviders.length > 0 ? installedProviders[0].id : '');

  const activeProvider = useMemo(() => {
    return installedProviders.find((p) => p.id === effectiveProviderId) ?? null;
  }, [installedProviders, effectiveProviderId]);

  // Extract model options from active provider if available
  const availableModels = useMemo(() => {
    if (!activeProvider) return [];
    const modelOption = activeProvider.configOptions?.find(
      (opt) => opt.id === 'model' || opt.id === 'selectedModel',
    );
    if (modelOption?.options && modelOption.options.length > 0) {
      return modelOption.options.map((o) => ({ id: o.value, name: o.name || o.value }));
    }
    return [];
  }, [activeProvider]);

  if (!isOpen) return null;

  const handleSpawn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sessionId || !prompt.trim() || isSpawning) return;

    setIsSpawning(true);
    try {
      await spawnParallelAgent(sessionId, {
        prompt: prompt.trim(),
        title: title.trim() || undefined,
        providerId: effectiveProviderId || undefined,
        modelId: selectedModel || undefined,
      });
      toast.success('Dispatched background agent in isolated workspace');
      setPrompt('');
      setTitle('');
      setSelectedModel('');
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to dispatch agent: ${msg}`);
    } finally {
      setIsSpawning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSpawn();
    }
  };

  return (
    <div className="animate-fadeIn fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <GlassPanel className="border-border/20 bg-surface/95 w-full max-w-lg rounded-2xl border p-5 shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="border-border/10 flex items-center justify-between border-b pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="border-accent/30 bg-accent/10 text-accent flex h-8 w-8 items-center justify-center rounded-lg border">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-text-main text-sm font-semibold">Spawn Background Agent</h2>
              <p className="text-text-muted/70 text-[11px]">
                Runs concurrently in an isolated workspace branch
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="text-text-muted hover:text-text-main rounded-md p-1 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSpawn} className="mt-4 space-y-3.5">
          <div>
            <label
              htmlFor="agent-prompt"
              className="text-text-muted mb-1 block text-[11px] font-medium"
            >
              Task Prompt *
            </label>
            <textarea
              id="agent-prompt"
              ref={promptRef}
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What should this agent work on in parallel? (e.g. Write unit tests for auth routes)"
              required
              className="border-border/30 bg-surface-secondary/40 text-text-main placeholder:text-text-muted/40 focus:border-accent/40 focus:bg-surface-secondary/80 w-full resize-none rounded-lg border p-3 text-xs transition-colors outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="agent-title"
                className="text-text-muted mb-1 block text-[11px] font-medium"
              >
                Task Title (optional)
              </label>
              <input
                id="agent-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Auth tests"
                className="border-border/30 bg-surface-secondary/40 text-text-main placeholder:text-text-muted/40 focus:border-accent/40 focus:bg-surface-secondary/80 h-[34px] w-full rounded-lg border px-3 text-xs transition-colors outline-none"
              />
            </div>

            <div>
              <span className="text-text-muted mb-1 block text-[11px] font-medium">
                Agent Provider
              </span>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    className="border-border/30 bg-surface-secondary/40 hover:bg-surface-secondary/60 text-text-main focus:border-accent/40 flex h-[34px] w-full cursor-pointer items-center justify-between rounded-lg border px-3 text-xs transition-colors outline-none"
                  >
                    <span className="truncate">
                      {activeProvider?.label || activeProvider?.id || 'Default Provider'}
                    </span>
                    <ChevronDown className="text-text-muted/60 h-3.5 w-3.5 shrink-0" />
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    align="start"
                    className="max-h-60 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] overflow-y-auto"
                  >
                    <div className="text-text-dim px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase">
                      Available Providers
                    </div>
                    {installedProviders.length > 0 ? (
                      installedProviders.map((p) => {
                        const isSelected = p.id === effectiveProviderId;
                        return (
                          <Dropdown.Item
                            key={p.id}
                            className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors"
                            onSelect={() => {
                              setSelectedProvider(p.id);
                              setSelectedModel('');
                            }}
                          >
                            <span className="truncate">{p.label || p.id}</span>
                            {isSelected && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
                          </Dropdown.Item>
                        );
                      })
                    ) : (
                      <Dropdown.Item
                        className="text-text-muted px-2.5 py-1.5 text-xs"
                        onSelect={() => setSelectedProvider('')}
                      >
                        Default Provider
                      </Dropdown.Item>
                    )}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          </div>

          {availableModels.length > 0 && (
            <div>
              <span className="text-text-muted mb-1 block text-[11px] font-medium">Model</span>
              <Dropdown.Root>
                <Dropdown.Trigger asChild>
                  <button
                    type="button"
                    className="border-border/30 bg-surface-secondary/40 hover:bg-surface-secondary/60 text-text-main focus:border-accent/40 flex h-[34px] w-full cursor-pointer items-center justify-between rounded-lg border px-3 text-xs transition-colors outline-none"
                  >
                    <span className="truncate">
                      {availableModels.find((m) => m.id === selectedModel)?.name || 'Default Model'}
                    </span>
                    <ChevronDown className="text-text-muted/60 h-3.5 w-3.5 shrink-0" />
                  </button>
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    align="start"
                    className="max-h-60 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] overflow-y-auto"
                  >
                    <Dropdown.Item
                      className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors"
                      onSelect={() => setSelectedModel('')}
                    >
                      <span>Default Model</span>
                      {!selectedModel && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
                    </Dropdown.Item>
                    {availableModels.map((m) => {
                      const isSelected = m.id === selectedModel;
                      return (
                        <Dropdown.Item
                          key={m.id}
                          className="hover:bg-surface-secondary text-text-main flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors"
                          onSelect={() => setSelectedModel(m.id)}
                        >
                          <span className="truncate">{m.name}</span>
                          {isSelected && <Check className="text-accent h-3.5 w-3.5 shrink-0" />}
                        </Dropdown.Item>
                      );
                    })}
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          )}

          <div className="border-accent/20 bg-accent/5 text-text-muted/80 flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-relaxed">
            <GitBranch className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your active workspace stays untouched. When done, you can review diffs and merge back
              with 1 click.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-text-muted text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="solid"
              size="sm"
              disabled={isSpawning || !prompt.trim()}
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              {isSpawning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>Dispatch Agent</span>
            </Button>
          </div>
        </form>
      </GlassPanel>
    </div>
  );
}
