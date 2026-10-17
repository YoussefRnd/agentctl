import {
  createContext,
  use,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { UpdateState } from '@/electron';

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
    let active = true;
    let observed = false;
    const unsubscribe = window.electronAPI.update.onUpdate((next) => {
      observed = true;
      if (active) setState(next);
    });
    void window.electronAPI.update
      .getState()
      .then((initial) => {
        // A delayed snapshot must not replace a more recent subscription event.
        if (active && !observed) setState(initial);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const install = useCallback(() => {
    window.electronAPI?.update.install();
  }, []);

  const check = useCallback(() => {
    window.electronAPI?.update.check();
  }, []);

  const value = useMemo<UpdateContextValue>(
    () => ({
      state,
      install,
      check,
    }),
    [state, install, check],
  );

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
