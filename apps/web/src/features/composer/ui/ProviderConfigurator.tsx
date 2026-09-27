import { useState, useCallback } from 'react';
import { Settings, ChevronUp, AlertCircle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { AgentIcon } from '@/shared';
import { ProviderPicker } from '@/features/providers';
import { CommandDropdown } from './CommandDropdown';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { ConfigOptionsPanel, useSession } from '@/features/sessions';
import {
  resolveAgentFeatures,
  type ProviderDiscovery,
  type SessionWithCapabilities,
} from '@agentctl/shared';

const PRIMARY_CONFIG_CATEGORIES = ['model', 'mode', 'thought_level'] as const;

export function ProviderPickerTrigger({
  isLoading,
  isOpen,
  onOpenChange,
  activeProvider,
  providers,
  selectedModelId,
  selectedProviderLabel,
  resolvedId,
  handleProviderSelect,
  sessionId,
  onOpenAuthModal,
}: {
  isLoading: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  activeProvider: ProviderDiscovery | undefined;
  providers: ProviderDiscovery[];
  selectedModelId: string | null | undefined;
  selectedProviderLabel: string;
  resolvedId: string | null;
  handleProviderSelect: (id: string, modelId?: string) => void;
  sessionId: string | null;
  onOpenAuthModal?: () => void;
}) {
  const needsAuth = activeProvider?.authState === 'required';

  const modelOption = activeProvider?.configOptions?.find(
    (opt) => opt.id === 'model' || opt.id === 'selectedModel',
  );
  const currentModelValue = selectedModelId ?? modelOption?.currentValue;
  const matchingModel = modelOption?.options?.find((o) => o.value === currentModelValue);
  const modelLabel =
    matchingModel?.name ?? (typeof currentModelValue === 'string' ? currentModelValue : null);

  const providerLabel = activeProvider?.label ?? selectedProviderLabel;
  const badgeLabel = isLoading
    ? 'Loading...'
    : modelLabel && modelLabel !== providerLabel
      ? `${providerLabel} · ${modelLabel}`
      : providerLabel;

  return (
    <div className="relative">
      {needsAuth ? (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            if (onOpenAuthModal) {
              onOpenAuthModal();
            } else {
              onOpenChange(!isOpen);
            }
          }}
          className={cn(
            'flex h-8 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 text-xs font-medium text-amber-300 transition-colors duration-200 hover:bg-amber-500/25 focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
            isLoading && 'pointer-events-none opacity-50',
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="max-w-[200px] truncate text-xs font-medium">
            {providerLabel} · Needs API key
          </span>
        </button>
      ) : (
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              aria-label="Select AI provider"
              aria-expanded={isOpen}
              className={cn(
                'motion-disclosure focus-visible:ring-accent/50 flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
                isOpen
                  ? 'bg-accent/20 text-accent border-accent/50'
                  : 'border-border/35 bg-surface-secondary/50 text-text-main hover:border-border/60 hover:bg-surface-secondary',
                isLoading && 'pointer-events-none opacity-50',
              )}
            >
              {isLoading ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
              ) : activeProvider?.agent?.icon ? (
                <img
                  src={activeProvider.agent.icon}
                  alt=""
                  className="h-3.5 w-3.5 object-contain"
                />
              ) : (
                <AgentIcon
                  className={cn(
                    'h-3.5 w-3.5 transition-colors duration-200',
                    isOpen && 'text-accent',
                  )}
                />
              )}
              <span className="max-w-[170px] truncate text-xs font-medium">{badgeLabel}</span>
              <ChevronUp
                className={cn(
                  'text-text-muted/60 h-3.5 w-3.5 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            avoidCollisions={false}
            surface="none"
            motion="none"
            className="bounded-glass-shell w-[380px]"
          >
            <div className="bounded-glass-surface">
              <ProviderPicker
                key={isOpen ? 'open' : 'closed'}
                sessionId={sessionId}
                isOpen={isOpen}
                onClose={() => {
                  onOpenChange(false);
                }}
                providers={providers}
                selectedId={resolvedId}
                selectedModelId={selectedModelId ?? null}
                onSelect={handleProviderSelect}
                onOpenAuthModal={onOpenAuthModal}
              />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function ThinkingEffortSelector({
  isLoading,
  sessionData,
  handleSetConfigOption,
  isUpdating,
}: {
  isLoading: boolean;
  sessionData: SessionWithCapabilities | null;
  handleSetConfigOption: (id: string, value: string) => Promise<void>;
  isUpdating: boolean;
}) {
  const option = sessionData?.session.sessionConfigOptions.find(
    (item) => item.category === 'thought_level',
  );
  const activeProvider = sessionData?.capabilities.find(
    (item) => item.id === sessionData.session.selectedProvider,
  );
  const onChange = useCallback(
    (value: string) => {
      if (option) void handleSetConfigOption(option.id, value);
    },
    [option, handleSetConfigOption],
  );
  if (
    isLoading ||
    !sessionData?.session ||
    !resolveAgentFeatures(activeProvider).configuration.options
  )
    return null;
  return (
    <ThinkingEffortControl
      key={`${sessionData.session.id}:${option?.id}`}
      option={option}
      isUpdating={isUpdating}
      onChange={onChange}
    />
  );
}

export function AgentPersonaSelector({
  isLoading,
  sessionData,
  isUpdating,
  setAgentPersona,
}: {
  isLoading: boolean;
  sessionData: SessionWithCapabilities | null;
  isUpdating: boolean;
  setAgentPersona: (persona: string) => Promise<void>;
}) {
  const { setSessionConfigOption } = useSession();
  if (isLoading || !sessionData?.session) return null;

  const { agentPersona, availableAgentPersonas } = sessionData.session;

  const modeOption = sessionData.session.sessionConfigOptions.find(
    (opt) => opt.category === 'mode',
  );

  if (!modeOption && availableAgentPersonas.length === 0) return null;

  return (
    <CommandDropdown
      value={
        typeof modeOption?.currentValue === 'string'
          ? modeOption.currentValue
          : (agentPersona ?? availableAgentPersonas[0])
      }
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        if (modeOption) {
          void setSessionConfigOption(modeOption.id, val);
        } else {
          void setAgentPersona(val);
        }
      }}
      options={
        modeOption
          ? (modeOption.options ?? []).map((o) => ({ value: o.value, label: o.name }))
          : availableAgentPersonas.map((p) => ({
              value: p,
              label: p.charAt(0).toUpperCase() + p.slice(1),
            }))
      }
      side="top"
    />
  );
}

export function AdvancedSettingsPopover({ isLoading }: { isLoading: boolean }) {
  const { sessionData } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (isLoading || !sessionData?.session) return null;

  const activeProvider = sessionData.capabilities.find(
    (provider) => provider.id === sessionData.session.selectedProvider,
  );
  if (!resolveAgentFeatures(activeProvider).configuration.options) return null;

  const hasAdditionalConfig = sessionData.session.sessionConfigOptions.some((opt) => {
    const cat = opt.category ?? 'other';
    return (
      !(PRIMARY_CONFIG_CATEGORIES as readonly string[]).includes(cat) &&
      !(PRIMARY_CONFIG_CATEGORIES as readonly string[]).includes(opt.id)
    );
  });

  if (!hasAdditionalConfig) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isLoading}
          className={cn(
            'motion-disclosure group border-border/25 bg-surface-secondary/35 text-text-muted hover:border-border/50 hover:bg-surface-secondary/70 hover:text-text-main focus-visible:ring-accent/50 flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border focus-visible:ring-2 focus-visible:outline-none',
            isOpen ? 'bg-accent/20 text-accent border-accent/50' : '',
          )}
          title="Advanced Settings"
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="border-border/50 bg-brand-mantle/95 w-[290px] rounded-xl border p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="custom-scrollbar max-h-[400px] overflow-y-auto pr-0.5">
          <ConfigOptionsPanel filterCategories={[...PRIMARY_CONFIG_CATEGORIES]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
