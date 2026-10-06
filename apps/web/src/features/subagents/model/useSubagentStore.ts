import { create } from 'zustand';
interface SubagentState {
  activeSubagentId: string | null;
  activeSessionId: string | null;
  setActiveSubagentId: (id: string | null, sessionId?: string) => void;
}

export const useSubagentStore = create<SubagentState>((set) => ({
  activeSubagentId: null,
  activeSessionId: null,
  setActiveSubagentId: (id, sessionId) =>
    set({
      activeSubagentId: id,
      activeSessionId: id ? (sessionId ?? null) : null,
    }),
}));
