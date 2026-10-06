import { RequestError } from '@agentclientprotocol/sdk';

export function throwIfRequestCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw RequestError.requestCancelled();
}

/** Cancel only this request's waiter; the underlying operation owns its lifecycle. */
export async function waitForRequest<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  cancelledResult?: () => T,
): Promise<T> {
  if (!signal) return work;
  let onAbort!: () => void;
  const cancelled = new Promise<T>((resolve, reject) => {
    onAbort = () => {
      if (cancelledResult) resolve(cancelledResult());
      else reject(RequestError.requestCancelled());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
