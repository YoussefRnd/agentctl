type Task<T> = () => Promise<T>;

export class GitMutex {
  private queues: Map<string, Promise<unknown>> = new Map();

  async run<T>(projectId: string, task: Task<T>): Promise<T> {
    const currentQueue = this.queues.get(projectId) || Promise.resolve();

    const nextTask = currentQueue
      .catch(() => {})
      .then(async () => {
        try {
          return await task();
        } finally {
          if (this.queues.get(projectId) === nextTask) {
            this.queues.delete(projectId);
          }
        }
      });

    this.queues.set(projectId, nextTask);
    return nextTask;
  }

  isPending(projectId: string): boolean {
    return this.queues.has(projectId);
  }
}
