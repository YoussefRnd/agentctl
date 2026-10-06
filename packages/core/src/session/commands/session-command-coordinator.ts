/** Serializes state changes. Normal turns and user input stay outside the lane. */
export class SessionCommandCoordinator {
  private lanes = new Map<string, Promise<unknown>>();

  run<T>(sessionId: string, command: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(command);
    this.lanes.set(sessionId, next);
    void next
      .finally(() => {
        if (this.lanes.get(sessionId) === next) this.lanes.delete(sessionId);
      })
      .catch(() => undefined);
    return next;
  }
}
