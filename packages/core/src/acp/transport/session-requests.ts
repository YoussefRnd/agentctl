import type { AgentSessionCallbacks } from '../../agent/types.js';
import { waitForRequest } from '../protocol/request-cancellation.js';

/** Session cancellation also cancels consent, independently of peer request cancellation. */
export function cancellableCallbacks(callbacks: AgentSessionCallbacks) {
  let turn = new AbortController();
  const requestSignal = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([turn.signal, signal]) : turn.signal;
  return {
    beginTurn() {
      if (turn.signal.aborted) turn = new AbortController();
    },
    cancel() {
      turn.abort();
    },
    callbacks: {
      ...callbacks,
      onRequestPermission: async (
        request: Parameters<AgentSessionCallbacks['onRequestPermission']>[0],
        signal?: AbortSignal,
      ) => {
        const combined = requestSignal(signal);
        const cancelled = () => ({ allowed: false, cancelled: true });
        if (combined.aborted) return cancelled();
        const response = await waitForRequest(
          callbacks.onRequestPermission(request, combined),
          combined,
          cancelled,
        );
        return combined.aborted ? cancelled() : response;
      },
      ...(callbacks.onRequestElicitation
        ? {
            onRequestElicitation: async (
              request: Parameters<NonNullable<AgentSessionCallbacks['onRequestElicitation']>>[0],
              signal?: AbortSignal,
            ) => {
              const combined = requestSignal(signal);
              const cancelled = () => ({ action: 'cancel' as const });
              if (combined.aborted) return cancelled();
              const response = await waitForRequest(
                callbacks.onRequestElicitation!(request, combined),
                combined,
                cancelled,
              );
              return combined.aborted ? cancelled() : response;
            },
          }
        : {}),
    } satisfies AgentSessionCallbacks,
  };
}
