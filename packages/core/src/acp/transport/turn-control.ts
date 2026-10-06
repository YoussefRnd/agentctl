import type { AgentSession } from '../../agent/types.js';
import { AgentError } from '../../agent/errors.js';
import { withTimeout } from './acp-process-lifecycle.js';
import type { cancellableCallbacks } from './session-requests.js';
import { ACP_SESSION_OPERATION_TIMEOUT_MS } from './limits.js';

/** Serializes cancellation with replacement prompts and retires unresponsive peers. */
export function guardAcpTurns(
  session: AgentSession,
  retire: () => void,
  {
    timeoutMs = ACP_SESSION_OPERATION_TIMEOUT_MS,
    requests,
  }: { timeoutMs?: number; requests?: ReturnType<typeof cancellableCallbacks> } = {},
): void {
  const prompt = session.prompt.bind(session);
  const cancel = session.cancel.bind(session);
  const close = session.close.bind(session);
  let active: Promise<unknown> | undefined;
  let cancelling: Promise<void> | undefined;
  let retired = false;
  let closing: Promise<void> | undefined;
  let rejectActive: ((error: unknown) => void) | undefined;
  const stop = (error?: unknown) => {
    retired = true;
    requests?.cancel();
    rejectActive?.(
      error ?? new AgentError('transport_lost', 'ACP session closed before the prompt completed'),
    );
  };
  void session.closed?.then(
    () => stop(),
    (error: unknown) => stop(error),
  );
  session.prompt = async (...args) => {
    await cancelling;
    if (retired) throw new Error('ACP runtime stopped or session closed');
    if (active) throw new Error('ACP session already has an active prompt');
    requests?.beginTurn();
    const stopped = new Promise<never>((_, reject) => {
      rejectActive = reject;
    });
    const work = Promise.race([prompt(...args), stopped]);
    active = work;
    try {
      return await work;
    } finally {
      if (active === work) {
        active = undefined;
        rejectActive = undefined;
      }
    }
  };
  session.cancel = () => {
    if (cancelling) return cancelling;
    const work = (async () => {
      try {
        requests?.cancel();
        await withTimeout(
          (async () => {
            await cancel();
            // A rejection is also a completed prompt; its caller owns the error.
            await active?.catch(() => undefined);
          })(),
          timeoutMs,
          'waiting for ACP cancellation',
        );
      } catch (error) {
        stop();
        retire();
        throw new Error('The agent did not complete cancellation. Its runtime was stopped.', {
          cause: error,
        });
      }
    })();
    cancelling = work;
    void work
      .finally(() => {
        if (cancelling === work) cancelling = undefined;
      })
      .catch(() => undefined);
    return work;
  };
  session.close = () => {
    if (closing) return closing;
    stop();
    closing = close();
    return closing;
  };
}
