import { AsyncResource } from 'node:async_hooks';

/** A shared budget prevents concurrent history requests from each consuming a full loop turn. */
export class SessionHistoryWorkQueue {
  private readonly jobs = new Set<() => void>();
  private scheduled = false;

  run<T>(work: Iterator<unknown, T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const resource = new AsyncResource('agentctl.history');
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        resource.emitDestroy();
      };
      const cancel = resource.bind(() => {
        this.jobs.delete(advance);
        cleanup();
        try {
          work.return?.();
          reject(signal?.reason);
        } catch (error) {
          reject(error);
        }
      });
      // The shared scheduler's context belongs to another request; restore this job's context.
      const advance = resource.bind(() => {
        this.jobs.delete(advance);
        try {
          const result = work.next();
          if (signal?.aborted) return;
          if (result.done) {
            cleanup();
            resolve(result.value);
          } else {
            this.jobs.add(advance);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
      this.jobs.add(advance);
      signal?.addEventListener('abort', cancel, { once: true });
      this.schedule();
    });
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      // Each step is one DB capture, bounded decode/stringify batch, or response assembly.
      // Individual SQLite calls and oversized events cannot be preempted.
      const deadline = performance.now() + 2;
      let steps = 0;
      while (this.jobs.size > 0) {
        this.jobs.values().next().value!();
        if (++steps >= 128 || performance.now() >= deadline) break;
      }
      this.scheduled = false;
      if (this.jobs.size > 0) this.schedule();
    });
  }
}
