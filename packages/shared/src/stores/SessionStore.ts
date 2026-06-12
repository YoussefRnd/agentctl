import type { SessionWithCapabilities } from '../session-schemas.js';

type Listener<T> = (state: T) => void;

export interface SessionState {
  currentSession: SessionWithCapabilities | null;
  isLoading: boolean;
}

export class SessionStore {
  private state: SessionState = {
    currentSession: null,
    isLoading: false,
  };

  private listeners = new Set<Listener<SessionState>>();

  getState(): SessionState {
    return this.state;
  }

  setSession(session: SessionWithCapabilities | null): void {
    this.state.currentSession = session;
    this.notify();
  }

  setLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.notify();
  }

  subscribe(listener: Listener<SessionState>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const currentState = this.getState();
    this.listeners.forEach((listener) => { listener(currentState); });
  }

  /**
   * Logic moved from React context to core store
   */
  resolveCapabilities() {
    if (!this.state.currentSession) return [];
    // Example logic that was previously in React
    return this.state.currentSession.capabilities;
  }
}

export const sessionStore = new SessionStore();
