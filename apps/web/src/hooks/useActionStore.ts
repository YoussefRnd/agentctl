import { create } from 'zustand';

interface ActionStore {
  pendingActions: Set<string>;
  addPending: (name: string) => void;
  removePending: (name: string) => void;
  isAnyPending: () => boolean;
}

export const useActionStore = create<ActionStore>((set, get) => ({
  pendingActions: new Set<string>(),
  addPending: (name: string) => {
    set((state) => {
      const newSet = new Set(state.pendingActions);
      newSet.add(name);
      return { pendingActions: newSet };
    });
  },
  removePending: (name: string) => {
    set((state) => {
      const newSet = new Set(state.pendingActions);
      newSet.delete(name);
      return { pendingActions: newSet };
    });
  },
  isAnyPending: () => get().pendingActions.size > 0,
}));
