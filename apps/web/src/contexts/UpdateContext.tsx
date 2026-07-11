import { createContext, use, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { UpdateState } from '../electron';

export interface UpdateContextValue {
  state: UpdateState;
  install: () => void;
  check: () => void;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    if (!window.electronAPI?.update) return;
    void window.electronAPI.update.getState().then(setState).catch(() => undefined);
    return window.electronAPI.update.onUpdate(setState);
  }, []);

  const install = useCallback(() => {
    window.electronAPI?.update.install();
  }, []);

  const check = useCallback(() => {
    window.electronAPI?.update.check();
  }, []);

  const value: UpdateContextValue = {
    state,
    install,
    check,
  };

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdateContext() {
  const context = use(UpdateContext);
  if (!context) {
    return {
      state: { status: 'idle' } as UpdateState,
      install: () => undefined,
      check: () => undefined,
    };
  }
  return context;
}
