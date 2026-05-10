type Task<T> = () => Promise<T>;

export class GitMutex {
  private queues: Map<string, Promise<unknown>> = new Map();

  async run<T>(projectId: string, task: Task<T>): Promise<T> {
    const currentQueue = this.queues.get(projectId) || Promise.resolve();
    
    const nextTask = currentQueue.then(async () => {
      try {
        return await task();
      } catch (e) {
        console.error(`Git Mutex Task failed for ${projectId}:`, e);
        throw e;
      }
    });

    this.queues.set(projectId, nextTask);
    return nextTask as Promise<T>;
  }
}
