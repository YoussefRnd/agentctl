const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const MAX_AUTH_FAILURES_PER_WINDOW = 10;

interface AuthFailureWindow {
  failures: number;
  resetsAt: number;
}

export class AuthAttemptLimiter {
  private readonly windows = new Map<string, AuthFailureWindow>();

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now >= window.resetsAt) {
      if (window) this.windows.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: window.failures < MAX_AUTH_FAILURES_PER_WINDOW,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - now) / 1000)),
    };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    if (this.windows.size >= 1_000) {
      for (const [windowKey, window] of this.windows) {
        if (now >= window.resetsAt) this.windows.delete(windowKey);
      }
      if (this.windows.size >= 1_000) {
        const oldestKey = this.windows.keys().next().value as string | undefined;
        if (oldestKey) this.windows.delete(oldestKey);
      }
    }
    const current = this.windows.get(key);
    if (!current || now >= current.resetsAt) {
      this.windows.set(key, { failures: 1, resetsAt: now + AUTH_ATTEMPT_WINDOW_MS });
      return;
    }
    current.failures += 1;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}
