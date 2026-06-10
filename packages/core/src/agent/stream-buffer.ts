export class StreamBuffer {
  private textBuffer = '';
  private timer: NodeJS.Timeout | null = null;
  private pendingBytesCount = 0;

  constructor(
    private onFlush: (content: string) => Promise<void> | void,
    private debounceMs = 500,
    private maxBufferSize = 1000,
  ) {}

  append(chunk: string) {
    this.textBuffer += chunk;
    this.pendingBytesCount += chunk.length;

    if (this.pendingBytesCount >= this.maxBufferSize) {
      void this.flush();
      return;
    }

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingBytesCount === 0) return;

    const contentToFlush = this.textBuffer;
    this.pendingBytesCount = 0;
    await this.onFlush(contentToFlush);
  }

  getContent(): string {
    return this.textBuffer;
  }

  reset() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.textBuffer = '';
    this.pendingBytesCount = 0;
  }
}
