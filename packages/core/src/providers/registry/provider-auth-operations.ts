/** Owns credential-family queues and the lifetime of each authentication attempt. */
export class ProviderAuthOperations {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly attempts = new Map<string, AbortController>();
  private closed = false;
  private readonly settling = new Map<string, Set<Promise<unknown>>>();

  async wait(key: string): Promise<void> {
    await this.pending.get(key)?.catch(() => undefined);
    this.assertOpen();
  }

  serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Provider authentication is disposed'));
    const previous = this.pending.get(key);
    const next = Promise.resolve(previous)
      .catch(() => undefined)
      .then(() => {
        this.assertOpen();
        return operation();
      });
    // The caller can observe cancellation promptly, but the family lane remains
    // held until credential-changing adapter work has actually settled.
    const barrier = next
      .catch(() => undefined)
      .then(async () => {
        await Promise.allSettled(this.settling.get(key) ?? []);
      })
      .finally(() => {
        if (this.pending.get(key) === barrier) this.pending.delete(key);
      });
    this.pending.set(key, barrier);
    return next;
  }

  begin(providerId: string, timeoutMs: number, externalSignal?: AbortSignal, key = providerId) {
    this.assertOpen();
    const controller = new AbortController();
    this.attempts.set(providerId, controller);
    const cancel = () => controller.abort(new Error('Authentication cancelled'));
    if (externalSignal?.aborted) cancel();
    else externalSignal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`Authentication timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    let rejectAbort: (reason: unknown) => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    // A signal already aborted before the listener was registered must still reject the race.
    if (controller.signal.aborted) onAbort();
    void aborted.catch(() => undefined);
    return {
      signal: controller.signal,
      race: <T>(operation: Promise<T>): Promise<T> => {
        const work = this.settling.get(key) ?? new Set<Promise<unknown>>();
        this.settling.set(key, work);
        work.add(operation);
        const settled = () => {
          work.delete(operation);
          if (!work.size && this.settling.get(key) === work) this.settling.delete(key);
        };
        void operation.then(settled, settled);
        return Promise.race([operation, aborted]);
      },
      close: () => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', onAbort);
        if (this.attempts.get(providerId) === controller) this.attempts.delete(providerId);
      },
    };
  }

  cancel(providerId: string): void {
    this.attempts.get(providerId)?.abort(new Error('Authentication cancelled'));
  }

  activeProviderIds(): string[] {
    return [...this.attempts.keys()];
  }

  async dispose(): Promise<void> {
    this.closed = true;
    for (const id of this.attempts.keys()) this.cancel(id);
    await Promise.allSettled(this.pending.values());
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Provider authentication is disposed');
  }
}
