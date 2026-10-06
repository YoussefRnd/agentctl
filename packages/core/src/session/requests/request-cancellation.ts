/** A request-scoped abort must release its waiter without cancelling another request or turn. */
export class RequestCancellation {
  readonly cancelled: Promise<void>;
  private resolve!: () => void;
  private listener = () => this.resolve();

  constructor(private signal?: AbortSignal) {
    this.cancelled = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
    if (signal?.aborted) this.resolve();
    else signal?.addEventListener('abort', this.listener, { once: true });
  }

  get aborted(): boolean {
    return this.signal?.aborted ?? false;
  }
  dispose(): void {
    this.signal?.removeEventListener('abort', this.listener);
  }
}
