export interface SseFrame {
  event: string;
  id: string | null;
  data: string;
}

/** Incremental SSE framing, including CRLF and fields split across transport chunks. */
export class SseDecoder {
  private pending = '';
  private event = 'message';
  private id: string | null = null;
  private data: string[] = [];
  private hasFields = false;
  push(chunk: string): SseFrame[] {
    this.pending += chunk;
    const frames: SseFrame[] = [];
    let start = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const char = this.pending[i];
      if (char !== '\r' && char !== '\n') continue;
      // Hold a trailing CR until the next chunk establishes CRLF versus CR.
      if (char === '\r' && i === this.pending.length - 1) break;
      const line = this.pending.slice(start, i);
      if (char === '\r' && this.pending[i + 1] === '\n') i++;
      start = i + 1;
      if (!line.trim()) {
        if (this.hasFields)
          frames.push({ event: this.event, id: this.id, data: this.data.join('\n') });
        this.event = 'message';
        this.id = null;
        this.data = [];
        this.hasFields = false;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') {
          this.event = value;
          this.hasFields = true;
        }
        if (field === 'id') {
          this.id = value;
          this.hasFields = true;
        }
        if (field === 'data') {
          this.data.push(value);
          this.hasFields = true;
        }
      }
    }
    this.pending = this.pending.slice(start);
    return frames;
  }
  finish(): SseFrame[] {
    return this.push('\n');
  }
}
