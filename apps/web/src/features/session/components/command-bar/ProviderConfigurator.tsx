import { useState } from 'react';
import { Zap, Brain, Settings2, ChevronUp } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@agentctl/ui';
import { ProviderPicker } from '../ProviderPicker';
import { CommandDropdown } from './CommandDropdown';
import { useSession } from '../../../../contexts/SessionContext';
import type { ProviderDiscovery, SessionWithCapabilities } from '@agentctl/shared';
import { ConfigOptionsPanel } from '../ConfigOptionsPanel';

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
}) {
  return (
    <div className="relative">
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            aria-label="Select AI provider"
            aria-expanded={isOpen}
            className={cn(
              'focus-visible:ring-accent/50 flex h-8 items-center gap-2 rounded-full border border-transparent px-3 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent focus-visible:outline-none',
              isOpen
                ? 'bg-accent/20 text-accent border-accent/50'
                : 'hover:bg-text-main/5 text-text-muted hover:text-text-main',
              isLoading && 'pointer-events-none opacity-50',
            )}
          >
            {isLoading ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : activeProvider?.icon ? (
              <img src={activeProvider.icon} alt="" className="h-3.5 w-3.5 object-contain" />
            ) : (
              <Zap
                className={cn('h-3.5 w-3.5 transition-all duration-200', isOpen && 'fill-accent')}
              />
            )}
            <span className="max-w-[120px] truncate text-[10px] font-bold tracking-widest uppercase">
              {isLoading ? '...' : (selectedModelId ?? selectedProviderLabel)}
            </span>
            <ChevronUp
              className={cn('h-3 w-3 transition-transform duration-200', isOpen && 'rotate-180')}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          avoidCollisions={false}
          className="border-border w-[480px] overflow-hidden rounded-md p-0"
        >
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
          />
        </PopoverContent>
      </Popover>
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
  if (isLoading || !sessionData?.session) return null;

  const thinkingOption = sessionData.session.sessionConfigOptions.find(
    (opt) => opt.category === 'thought_level',
  );

  if (!thinkingOption) return null;

  return (
    <CommandDropdown
      value={thinkingOption.currentValue}
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        void handleSetConfigOption(thinkingOption.id, val);
      }}
      icon={<Brain className="text-accent h-3.5 w-3.5" />}
      options={thinkingOption.options.map((opt) => ({
        value: opt.value,
        label: opt.name,
      }))}
      side="top"
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
      value={modeOption?.currentValue ?? agentPersona ?? availableAgentPersonas[0]}
      disabled={isUpdating}
      variant="toolbar"
      onChange={(val) => {
        if (modeOption) {
          void setSessionConfigOption(modeOption.id, val);
        } else {
          void setAgentPersona(val);
        }
      }}
      icon={<Zap className="text-accent h-3.5 w-3.5" />}
      options={
        modeOption
          ? modeOption.options.map((o) => ({ value: o.value, label: o.name }))
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
  const [isOpen, setIsOpen] = useState(false);

  if (isLoading) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isLoading}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border border-transparent transition-all duration-200',
            isOpen
              ? 'bg-accent/20 text-accent border-accent/40'
              : 'text-text-muted hover:text-text-main hover:bg-text-main/5',
          )}
          title="Advanced Settings"
        >
          <Settings2 size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={12}
        className="w-[320px] rounded-xl p-4 shadow-2xl"
      >
        <div className="custom-scrollbar max-h-[400px] overflow-y-auto pr-1">
          <ConfigOptionsPanel filterCategories={[...PRIMARY_CONFIG_CATEGORIES]} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
