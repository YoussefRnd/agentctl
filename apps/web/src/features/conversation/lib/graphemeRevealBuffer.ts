const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export function splitGraphemes(value: string): string[] {
  if (!segmenter) return Array.from(value);
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

/** Segment new provider text once; animation frames consume the cached reveal units. */
export class GraphemeRevealBuffer {
  target: string;
  displayed: string;
  private lastGrapheme: string;
  private queue: string[] = [];
  private head = 0;

  constructor(value: string) {
    this.target = this.displayed = value;
    this.lastGrapheme = splitGraphemes(value).at(-1) ?? '';
  }

  get backlog(): number {
    return this.queue.length - this.head;
  }

  update(value: string): { growth: number; replaced: boolean } {
    if (value === this.target) return { growth: 0, replaced: false };
    if (!value.startsWith(this.target)) {
      this.target = this.displayed = value;
      this.lastGrapheme = splitGraphemes(value).at(-1) ?? '';
      this.queue = [];
      this.head = 0;
      return { growth: 0, replaced: true };
    }

    // Re-segment the final cluster as well: a chunk may extend an emoji, combining
    // sequence, flag, CRLF, or surrogate pair that began in the previous chunk.
    const boundary = this.target.length - this.lastGrapheme.length;
    const units = splitGraphemes(value.slice(boundary));
    const hadLastGrapheme = this.lastGrapheme.length > 0;
    if (this.backlog > 0) {
      if (hadLastGrapheme) this.queue.pop();
      for (const unit of units) this.queue.push(unit);
    } else {
      this.queue = [];
      this.head = 0;
      if (hadLastGrapheme) {
        this.displayed = this.displayed.slice(0, boundary) + units[0];
      }
      for (const unit of units.slice(hadLastGrapheme ? 1 : 0)) this.queue.push(unit);
    }
    this.target = value;
    this.lastGrapheme = units.at(-1) ?? '';
    return { growth: units.length - (hadLastGrapheme ? 1 : 0), replaced: false };
  }

  reveal(count: number): string {
    const end = Math.min(this.queue.length, this.head + count);
    this.displayed += this.queue.slice(this.head, end).join('');
    this.head = end;
    if (this.head === this.queue.length) {
      this.queue = [];
      this.head = 0;
    } else if (this.head > 1024 && this.head > this.queue.length / 2) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    return this.displayed;
  }

  finish(): string {
    this.displayed = this.target;
    this.queue = [];
    this.head = 0;
    return this.displayed;
  }
}
