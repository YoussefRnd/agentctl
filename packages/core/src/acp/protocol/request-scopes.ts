/** Correlate request-scoped elicitations with the exact outstanding client request. */
export class AcpRequestScopes<T> {
  private scopes = new Map<string | number, T>();
  constructor(
    private resolve: (method: string, params: Record<string, unknown>) => T | undefined,
  ) {}

  observe(direction: 'send' | 'recv', message: unknown): void {
    if (Array.isArray(message)) {
      for (const frame of message) this.observe(direction, frame);
      return;
    }
    if (!message || typeof message !== 'object') return;
    const frame = message as Record<string, unknown>;
    if (typeof frame.id !== 'string' && typeof frame.id !== 'number') return;
    if (direction === 'recv' && ('result' in frame || 'error' in frame)) {
      this.scopes.delete(frame.id);
    } else if (direction === 'send' && typeof frame.method === 'string') {
      const params =
        frame.params && typeof frame.params === 'object' && !Array.isArray(frame.params)
          ? (frame.params as Record<string, unknown>)
          : {};
      const scope = this.resolve(frame.method, params);
      if (scope !== undefined) this.scopes.set(frame.id, scope);
    }
  }

  get(requestId: string | number): T | undefined {
    return this.scopes.get(requestId);
  }
  release(predicate: (scope: T) => boolean): void {
    for (const [id, scope] of this.scopes) if (predicate(scope)) this.scopes.delete(id);
  }
  clear(): void {
    this.scopes.clear();
  }
}

export const SESSION_REQUEST_METHODS = new Set([
  'session/new',
  'session/load',
  'session/resume',
  'session/fork',
  'session/prompt',
]);
