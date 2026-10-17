interface ProviderOperation {
  name: string;
  promise: Promise<unknown>;
}

interface CoordinationWaiter {
  kind: 'mutation' | 'sync';
  resolve: (release: () => void) => void;
}

export class ProviderOperationCoordinator {
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private providerOperations = new Map<string, ProviderOperation>();
  private activeMutations = 0;
  private syncActive = false;
  private coordinationWaiters: CoordinationWaiter[] = [];

  acquireMutation(): Promise<() => void> {
    if (!this.syncActive && this.coordinationWaiters.length === 0) {
      this.activeMutations += 1;
      return Promise.resolve(this.once(() => this.releaseMutation()));
    }

    return new Promise((resolve) => {
      this.coordinationWaiters.push({ kind: 'mutation', resolve });
      this.processCoordinationWaiters();
    });
  }

  acquireSync(): Promise<() => void> {
    if (!this.syncActive && this.activeMutations === 0 && this.coordinationWaiters.length === 0) {
      this.syncActive = true;
      return Promise.resolve(this.once(() => this.releaseSync()));
    }

    return new Promise((resolve) => {
      this.coordinationWaiters.push({ kind: 'sync', resolve });
      this.processCoordinationWaiters();
    });
  }

  releaseMutation(): void {
    this.activeMutations -= 1;
    this.processCoordinationWaiters();
  }

  releaseSync(): void {
    this.syncActive = false;
    this.processCoordinationWaiters();
  }

  private processCoordinationWaiters(): void {
    if (this.syncActive || this.activeMutations > 0 || this.coordinationWaiters.length === 0) {
      return;
    }

    if (this.coordinationWaiters[0].kind === 'sync') {
      const waiter = this.coordinationWaiters.shift();
      if (!waiter) return;
      this.syncActive = true;
      waiter.resolve(this.once(() => this.releaseSync()));
      return;
    }

    while (this.coordinationWaiters.length > 0) {
      const waiter: CoordinationWaiter = this.coordinationWaiters[0];
      if (waiter.kind !== 'mutation') break;
      this.coordinationWaiters.shift();
      this.activeMutations += 1;
      waiter.resolve(this.once(() => this.releaseMutation()));
    }
  }

  private async executeMutation<T>(op: () => Promise<T>): Promise<T> {
    const release = await this.acquireMutation();
    try {
      this.assertOpen();
      return await op();
    } finally {
      release();
    }
  }

  private async executeSync(op: () => Promise<void>): Promise<void> {
    const release = await this.acquireSync();
    try {
      this.assertOpen();
      await op();
    } finally {
      release();
    }
  }

  runMutation<T>(op: () => Promise<T>): Promise<T> {
    return this.track(this.executeMutation(op));
  }
  runSync(op: () => Promise<void>): Promise<void> {
    return this.track(this.executeSync(op));
  }

  stop(): void {
    this.closed = true;
  }
  async idle(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Provider registry is disposed');
  }
  private once(release: () => void): () => void {
    let released = false;
    return () => {
      if (!released) {
        released = true;
        release();
      }
    };
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    );
    return promise;
  }

  runProviderOperation<T>(
    providerId: string,
    operationName: string,
    op: () => Promise<T>,
  ): Promise<T> {
    const previous = this.providerOperations.get(providerId);
    if (previous?.name === operationName) {
      return previous.promise as Promise<T>;
    }

    const promise = this.runMutation(async () => {
      await previous?.promise.catch(() => undefined);
      this.assertOpen();
      return op();
    });
    this.providerOperations.set(providerId, { name: operationName, promise });

    void promise.then(
      () => {
        this.clearProviderOperation(providerId, promise);
      },
      () => {
        this.clearProviderOperation(providerId, promise);
      },
    );
    return promise;
  }

  clearProviderOperation(providerId: string, promise: Promise<unknown>): void {
    if (this.providerOperations.get(providerId)?.promise === promise) {
      this.providerOperations.delete(providerId);
    }
  }
}
