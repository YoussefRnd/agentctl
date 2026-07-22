import path from 'node:path';
import fs from 'node:fs/promises';

export interface GitMutexOptions {
  timeoutMs?: number;
  queueTimeoutMs?: number;
  signal?: AbortSignal;
}

export type GitTask<T> = (signal: AbortSignal) => Promise<T> | T;

interface QueueEntry<T> {
  task: GitTask<T>;
  options?: GitMutexOptions;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  status: 'waiting' | 'running' | 'aborted';
  controller: AbortController;
  queueTimeoutTimer?: NodeJS.Timeout;
  taskTimeoutTimer?: NodeJS.Timeout;
  abortListener?: () => void;
}

export class GitMutex {
  private queues = new Map<string, QueueEntry<unknown>[]>();

  async run<T>(key: string, task: GitTask<T>, options?: GitMutexOptions): Promise<T> {
    const queueTimeoutMs = options?.queueTimeoutMs;
    const externalSignal = options?.signal;

    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? new Error('Operation aborted');
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        task,
        options,
        resolve,
        reject,
        status: 'waiting',
        controller: new AbortController(),
      };

      let queue = this.queues.get(key);
      if (!queue) {
        queue = [];
        this.queues.set(key, queue);
      }
      queue.push(entry as QueueEntry<unknown>);

      if (queueTimeoutMs !== undefined) {
        entry.queueTimeoutTimer = setTimeout(() => {
          this.abortEntry(
            key,
            entry as QueueEntry<unknown>,
            new Error(`Queue wait timed out after ${queueTimeoutMs.toString()}ms`),
          );
        }, queueTimeoutMs);
      }

      if (externalSignal) {
        entry.abortListener = () => {
          const reason =
            externalSignal.reason instanceof Error
              ? externalSignal.reason
              : new Error(String(externalSignal.reason ?? 'Operation aborted'));
          this.abortEntry(key, entry as QueueEntry<unknown>, reason);
        };
        externalSignal.addEventListener('abort', entry.abortListener);
      }

      if (queue.length === 1) {
        void this.processQueue(key);
      }
    });
  }

  private async processQueue(key: string): Promise<void> {
    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) {
      return;
    }

    const entry = queue[0];
    if (entry.status !== 'waiting') {
      queue.shift();
      if (queue.length === 0) {
        this.queues.delete(key);
      } else {
        void this.processQueue(key);
      }
      return;
    }

    entry.status = 'running';

    if (entry.queueTimeoutTimer) {
      clearTimeout(entry.queueTimeoutTimer);
      entry.queueTimeoutTimer = undefined;
    }

    // Try to prune stale lockfile before executing the git task
    await this.tryPruneStaleLockfile(key);

    let signalToPass = entry.controller.signal;
    if (entry.options?.signal) {
      signalToPass = AbortSignal.any([entry.controller.signal, entry.options.signal]);
    }

    const timeoutMs = entry.options?.timeoutMs;
    if (timeoutMs !== undefined) {
      entry.taskTimeoutTimer = setTimeout(() => {
        this.abortEntry(
          key,
          entry,
          new Error(`Task execution timed out after ${timeoutMs.toString()}ms`),
        );
      }, timeoutMs);
    }

    try {
      const result = await entry.task(signalToPass);
      if ((entry.status as unknown) === 'running') {
        entry.resolve(result);
      }
    } catch (err) {
      if ((entry.status as unknown) === 'running') {
        entry.reject(err);
      }
    } finally {
      if (entry.taskTimeoutTimer) {
        clearTimeout(entry.taskTimeoutTimer);
        entry.taskTimeoutTimer = undefined;
      }
      if (entry.options?.signal && entry.abortListener) {
        entry.options.signal.removeEventListener('abort', entry.abortListener);
        entry.abortListener = undefined;
      }

      if ((entry.status as unknown) === 'running') {
        const currentQueue = this.queues.get(key);
        if (currentQueue) {
          if (currentQueue[0] === entry) {
            currentQueue.shift();
          }
          if (currentQueue.length === 0) {
            this.queues.delete(key);
          } else {
            void this.processQueue(key);
          }
        }
      }
    }
  }

  private abortEntry(key: string, entry: QueueEntry<unknown>, error: Error) {
    if (entry.status === 'aborted') {
      return;
    }

    entry.status = 'aborted';

    if (entry.queueTimeoutTimer) {
      clearTimeout(entry.queueTimeoutTimer);
      entry.queueTimeoutTimer = undefined;
    }
    if (entry.taskTimeoutTimer) {
      clearTimeout(entry.taskTimeoutTimer);
      entry.taskTimeoutTimer = undefined;
    }
    if (entry.options?.signal && entry.abortListener) {
      entry.options.signal.removeEventListener('abort', entry.abortListener);
      entry.abortListener = undefined;
    }

    entry.controller.abort(error);
    entry.reject(error);

    const queue = this.queues.get(key);
    if (queue) {
      const index = queue.indexOf(entry);
      if (index !== -1) {
        queue.splice(index, 1);
      }
      if (queue.length === 0) {
        this.queues.delete(key);
      } else if (index === 0) {
        void this.processQueue(key);
      }
    }
  }

  isPending(key: string): boolean {
    const queue = this.queues.get(key);
    return queue !== undefined && queue.length > 0;
  }

  private async tryPruneStaleLockfile(dir: string): Promise<void> {
    if (!path.isAbsolute(dir)) {
      return;
    }

    try {
      const stats = await fs.stat(dir);
      if (!stats.isDirectory()) {
        return;
      }

      let gitDir = path.join(dir, '.git');
      const gitStats = await fs.stat(gitDir).catch(() => null);

      if (gitStats) {
        if (gitStats.isFile()) {
          const content = await fs.readFile(gitDir, 'utf8');
          const match = /^gitdir:\s*(.+)$/m.exec(content);
          if (match) {
            gitDir = match[1].trim();
          }
        }
      } else {
        const isGitDir = await fs
          .stat(path.join(dir, 'config'))
          .then(() => true)
          .catch(() => false);
        if (isGitDir) {
          gitDir = dir;
        } else {
          return;
        }
      }

      const lockfile = path.join(gitDir, 'index.lock');
      const lockStats = await fs.stat(lockfile).catch(() => null);
      if (lockStats) {
        const ageMs = Date.now() - lockStats.mtimeMs;
        if (ageMs > 3 * 60 * 1000) {
          await fs.rm(lockfile, { force: true });
        }
      }
    } catch {
      // Ignore errors
    }
  }
}
