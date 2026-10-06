import type { AgentSessionCallbacks } from '../../agent/types.js';
import { ACP_MAX_PENDING_UPDATES } from './limits.js';

/** Preserve ordering and retain persistence failures until the caller checks completion. */
export class AcpUpdateQueue {
  private queued: Promise<void> = Promise.resolve();
  private failed = false;
  private failure: unknown;
  private pending = 0;

  constructor(private readonly limit = ACP_MAX_PENDING_UPDATES) {}

  private rememberFailure(error: unknown): void {
    if (!this.failed) this.failure = error;
    this.failed = true;
  }

  enqueue(work: () => void | Promise<void>): Promise<void> {
    if (this.pending >= this.limit) {
      const error = new Error('Too many pending ACP session updates');
      this.rememberFailure(error);
      const rejected = Promise.reject(error);
      void rejected.catch(() => undefined);
      return rejected;
    }
    this.pending++;
    const next = this.queued
      .catch(() => undefined)
      .then(work)
      .catch((error: unknown) => {
        this.rememberFailure(error);
        throw error;
      })
      .finally(() => {
        this.pending--;
      });
    this.queued = next;
    void next.catch(() => undefined);
    return next;
  }

  async settled(): Promise<void> {
    let snapshot: Promise<void>;
    do {
      snapshot = this.queued;
      await snapshot.catch(() => undefined);
    } while (snapshot !== this.queued);
  }

  async drain(): Promise<void> {
    await this.settled();
    if (this.failed) {
      const error = this.failure;
      this.failed = false;
      this.failure = undefined;
      throw error;
    }
  }
}

/** Make prompt completion wait for all persisted updates, including failed writes. */
export function drainableCallbacks(callbacks: AgentSessionCallbacks) {
  const queue = new AcpUpdateQueue();
  return {
    callbacks: {
      ...callbacks,
      onUpdate: (event: Parameters<AgentSessionCallbacks['onUpdate']>[0]) => {
        return queue.enqueue(async () => {
          await callbacks.onUpdate(event);
        });
      },
    },
    drain: () => queue.drain(),
  };
}
