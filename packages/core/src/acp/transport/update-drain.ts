import type { AgentSessionCallbacks } from '../../agent/types.js';
import {
  ACP_MAX_PENDING_UPDATES,
  ACP_MAX_PENDING_UPDATE_BYTES,
  acpPayloadBytes,
} from './limits.js';

/** Preserve ordering and retain persistence failures until the caller checks completion. */
export class AcpUpdateQueue {
  private queued: Promise<void> = Promise.resolve();
  private failed = false;
  private failure: unknown;
  private pending = 0;
  private bytes = 0;
  private peakPending = 0;
  private peakBytes = 0;

  constructor(
    private readonly limit = ACP_MAX_PENDING_UPDATES,
    private readonly byteLimit = ACP_MAX_PENDING_UPDATE_BYTES,
  ) {}

  snapshot() {
    return {
      pending: this.pending,
      bytes: this.bytes,
      peakPending: this.peakPending,
      peakBytes: this.peakBytes,
    };
  }

  private rememberFailure(error: unknown): void {
    if (!this.failed) this.failure = error;
    this.failed = true;
  }

  enqueue(work: () => void | Promise<void>, payload?: unknown): Promise<void> {
    const bytes = payload === undefined ? 0 : acpPayloadBytes(payload);
    if (this.pending >= this.limit || bytes > this.byteLimit - this.bytes) {
      const error = new Error(
        this.pending >= this.limit
          ? 'Too many pending ACP session updates'
          : 'ACP session update byte budget exceeded',
      );
      this.rememberFailure(error);
      const rejected = Promise.reject(error);
      void rejected.catch(() => undefined);
      return rejected;
    }
    this.pending++;
    this.bytes += bytes;
    this.peakPending = Math.max(this.peakPending, this.pending);
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
    const next = this.queued
      .catch(() => undefined)
      .then(work)
      .catch((error: unknown) => {
        this.rememberFailure(error);
        throw error;
      })
      .finally(() => {
        this.pending--;
        this.bytes -= bytes;
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
        }, event);
      },
    },
    drain: () => queue.drain(),
  };
}
