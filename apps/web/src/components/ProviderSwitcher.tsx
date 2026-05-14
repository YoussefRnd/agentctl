import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client.js';

interface DriverCapability {
  driver: 'claude-code' | 'gemini-cli' | 'opencode' | 'codex-acp';
  label: string;
  command: string;
  models: string[];
  thinkingEfforts: ('low' | 'medium' | 'high')[];
}

interface SessionWithCapabilities {
  session: {
    id: string;
    selectedDriver: DriverCapability['driver'];
    selectedModel: string;
    selectedThinkingEffort: 'low' | 'medium' | 'high';
  };
  capabilities: DriverCapability[];
}

interface SessionProviderSelection {
  selectedDriver: DriverCapability['driver'];
  selectedModel: string;
  selectedThinkingEffort: 'low' | 'medium' | 'high';
}

interface Props {
  sessionId: string;
  data: SessionWithCapabilities | null;
}

export function ProviderSwitcher({ sessionId, data }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const selection = data?.session;
  const capabilities = data?.capabilities ?? [];

  const currentCapability = useMemo(() => {
    if (!selection) return null;
    return capabilities.find((item) => item.driver === selection.selectedDriver) ?? null;
  }, [capabilities, selection]);

  const currentCapabilityLabel = currentCapability?.label ?? selection?.selectedDriver ?? '';

  const mutation = useMutation({
    mutationFn: (payload: SessionProviderSelection) => apiClient.fetch<SessionWithCapabilities>(`/api/sessions/${sessionId}/provider`, {
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

  return (
    <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); }}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-text-main hover:bg-background"
      >
        <span className="truncate font-medium">{currentCapabilityLabel}</span>
        <span className="text-text-muted">{selection.selectedModel}</span>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">{selection.selectedThinkingEffort}</span>
      </button>
      {open && (
        <div className="absolute right-4 top-14 z-20 w-72 rounded-xl border border-border bg-background p-2 shadow-xl">
          {capabilities.map((capability: SessionWithCapabilities['capabilities'][number]) => (
            <button
              key={capability.driver}
              type="button"
              onClick={() => {
                setOpen(false);
                mutation.mutate({
                  selectedDriver: capability.driver,
                  selectedModel: capability.models[0],
                  selectedThinkingEffort: capability.thinkingEfforts[0],
                });
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface"
            >
              <span>{capability.label}</span>
              <span className="text-xs text-text-muted">{capability.models[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
