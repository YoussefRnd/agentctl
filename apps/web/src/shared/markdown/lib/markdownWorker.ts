import type { Root } from 'hast';
import type { MarkdownResult } from './markdownProcessor';

type Listener = (tree: Root | null) => void;
interface Job {
  id: number;
  content: string;
  listeners: Set<Listener>;
}

// One shared worker, with only subscribed jobs retained. Completed documents are
// not cached: old conversation text and large syntax trees should not accumulate.
export class MarkdownWorker {
  private worker: Worker | null = null;
  private failed = false;
  private nextId = 0;
  private active: Job | null = null;
  private queue: Job[] = [];
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private createWorker = () =>
      new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  subscribe(content: string, listener: Listener): () => void {
    if (this.failed) {
      listener(null);
      return () => {};
    }
    if (!this.worker) {
      try {
        this.worker = this.createWorker();
        this.worker.onmessage = (event: MessageEvent<MarkdownResult>) => this.receive(event.data);
        this.worker.onerror = () => this.fail();
        this.worker.onmessageerror = () => this.fail();
      } catch {
        this.fail();
        listener(null);
        return () => {};
      }
    }
    let job =
      this.active?.content === content
        ? this.active
        : this.queue.find((item) => item.content === content);
    if (!job) {
      job = { id: ++this.nextId, content, listeners: new Set() };
      this.queue.push(job);
    }
    job.listeners.add(listener);
    this.dispatch();
    return () => {
      job.listeners.delete(listener);
      if (job.listeners.size === 0) this.queue = this.queue.filter((item) => item !== job);
    };
  }

  private dispatch() {
    if (this.active || !this.worker || this.queue.length === 0) return;
    this.active = this.queue.shift()!;
    this.timeout = setTimeout(() => this.fail(), 15000);
    try {
      this.worker.postMessage({ id: this.active.id, content: this.active.content });
    } catch {
      this.fail();
    }
  }

  private receive(result: MarkdownResult) {
    if (result.id !== this.active?.id) return;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    const job = this.active;
    this.active = null;
    for (const listener of job.listeners) listener('tree' in result ? result.tree : null);
    this.dispatch();
  }

  private fail() {
    this.failed = true;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.worker?.terminate();
    this.worker = null;
    const jobs = this.active ? [this.active, ...this.queue] : this.queue;
    this.active = null;
    this.queue = [];
    for (const job of jobs) for (const listener of job.listeners) listener(null);
  }
}

const markdownWorker = new MarkdownWorker();
export const subscribeMarkdown = (content: string, listener: Listener) =>
  markdownWorker.subscribe(content, listener);
