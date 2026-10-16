/** Coalesces full-content writes; explicit flush waits for in-flight persistence. */
export class StreamBuffer {
  private textBuffer = '';
  private timer: NodeJS.Timeout | null = null;
  private maxAgeTimer: NodeJS.Timeout | null = null;
  private pendingBytesCount = 0;
  private writing?: Promise<void>;
  private generation = 0;

  constructor(
    private onFlush: (content: string) => Promise<void> | void,
    private debounceMs = 500,
    private maxBufferSize = 1000,
    private maxAgeMs = 1000,
    private onError: (error: unknown) => void = () => {},
  ) {}

  append(chunk: string) {
    this.textBuffer += chunk;
    this.pendingBytesCount += chunk.length;
    if (this.pendingBytesCount >= this.maxBufferSize) {
      this.flushInBackground();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushInBackground(), this.debounceMs);
    if (!this.maxAgeTimer && this.maxAgeMs > 0) {
      this.maxAgeTimer = setTimeout(() => this.flushInBackground(), this.maxAgeMs);
    }
  }

  private flushInBackground(): void {
    void this.flush().catch(this.onError);
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.maxAgeTimer) clearTimeout(this.maxAgeTimer);
    this.timer = null;
    this.maxAgeTimer = null;
  }

  async flush(): Promise<void> {
    this.clearTimers();
    while (this.writing) await this.writing;
    if (this.pendingBytesCount === 0) return;
    const generation = this.generation;
    const bytes = this.pendingBytesCount;
    this.pendingBytesCount = 0;
    // Invoke immediately so the projector captures the current row before it can change.
    const writing = (async () => {
      await this.onFlush(this.textBuffer);
    })();
    this.writing = writing;
    try {
      await writing;
    } catch (error) {
      if (this.generation === generation) this.pendingBytesCount += bytes;
      throw error;
    } finally {
      if (this.writing === writing) this.writing = undefined;
    }
  }

  getContent(): string {
    return this.textBuffer;
  }

  reset(): void {
    this.clearTimers();
    this.generation++;
    this.textBuffer = '';
    this.pendingBytesCount = 0;
  }
}
