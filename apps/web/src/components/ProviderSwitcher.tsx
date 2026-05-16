import { useMemo, useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';
import type { DriverDiscovery, SessionRow, SessionProviderSelection, DriverName, ThinkingEffort } from '@agentctl/shared';

interface SessionWithCapabilities {
  session: SessionRow;
  capabilities: DriverDiscovery[];
}

interface Props {
  sessionId: string;
  data: SessionWithCapabilities | null;
}

export function ProviderSwitcher({ sessionId, data }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selection = data?.session;
  const capabilities = data?.capabilities ?? [];

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const currentCapability = useMemo(() => {
    if (!selection) return null;
    return capabilities.find((item) => item.id === selection.selectedDriver) ?? null;
  }, [capabilities, selection]);

  const currentCapabilityLabel = currentCapability?.label ?? selection?.selectedDriver ?? '';

  const mutation = useMutation({
    mutationFn: (payload: Partial<SessionProviderSelection>) => apiClient.fetch<SessionWithCapabilities>(`/api/sessions/${sessionId}/provider`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['session', sessionId] });
      const previous = queryClient.getQueryData<SessionWithCapabilities>(['session', sessionId]) ?? null;
      if (previous) {
        queryClient.setQueryData<SessionWithCapabilities>(['session', sessionId], {
          ...previous,
          session: { ...previous.session, ...payload },
        });
      }
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['session', sessionId], context.previous);
      }
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['session', sessionId], next);
    },
  });

  if (!selection) return null;

  const handleOptionChange = (optionId: string, value: string) => {
    const payload: Partial<SessionProviderSelection> = {
      selectedDriver: selection.selectedDriver,
    };

    if (optionId === 'model') {
      payload.selectedModel = value;
    } else if (optionId === 'thinking' || optionId === 'thinking_effort') {
      payload.selectedThinkingEffort = value as ThinkingEffort;
    }
    
    mutation.mutate(payload);
  };

  return (
    <div ref={containerRef} className="flex items-center gap-2 text-xs sm:text-sm min-w-0 relative">
      <div className="flex items-center gap-1 rounded-full border border-border bg-surface/80 px-2 py-1">
        <button
          type="button"
          onClick={() => { setOpen((value) => !value); }}
          className="px-2 py-0.5 font-medium hover:text-accent truncate transition-colors"
        >
          {currentCapabilityLabel}
        </button>
        
        <div className="h-4 w-[1px] bg-border mx-1" />

        {currentCapability?.configOptions?.map((option) => (
          <select
            key={option.id}
            value={option.currentValue}
            onChange={(e) => { handleOptionChange(option.id, e.target.value); }}
            className="bg-transparent px-2 py-0.5 hover:text-accent focus:outline-none cursor-pointer transition-colors"
          >
            {option.options.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-background">
                {opt.name}
              </option>
            ))}
          </select>
        ))}
      </div>

      {open && (
        <div className="absolute left-0 top-10 z-20 w-64 rounded-xl border border-border bg-background p-2 shadow-xl animate-in fade-in slide-in-from-top-2">
          <p className="px-3 py-2 text-[10px] font-bold text-text-muted uppercase tracking-wider">Switch Provider</p>
          {capabilities.map((capability) => {
            const isReady = capability.status === 'ready';
            return (
              <button
                key={capability.id}
                type="button"
                disabled={!isReady || mutation.isPending}
                onClick={() => {
                  setOpen(false);
                  const payload: Partial<SessionProviderSelection> = {
                    selectedDriver: capability.id as DriverName,
                  };
                  // Use first available options as defaults
                  capability.configOptions?.forEach(opt => {
                    if (opt.id === 'model') {
                      payload.selectedModel = opt.options[0].value;
                    } else if (opt.id === 'thinking' || opt.id === 'thinking_effort') {
                      payload.selectedThinkingEffort = opt.options[0].value as ThinkingEffort;
                    }
                  });
                  mutation.mutate(payload);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface disabled:opacity-50"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{capability.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {isReady ? (
                    <div className="w-2 h-2 bg-success rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  ) : (
                    <div className="w-2 h-2 bg-danger rounded-full shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                  )}
                  </div>
                {isReady && capability.configOptions?.find(o => o.id === 'model') && (
                  <span className="text-xs text-text-muted">
                    {capability.configOptions.find(o => o.id === 'model')?.options[0].name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
