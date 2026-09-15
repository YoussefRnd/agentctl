import { create } from 'zustand';
interface SubagentState {
  activeSubagentId: string | null;
  setActiveSubagentId: (id: string | null) => void;
}

export const useSubagentStore = create<SubagentState>((set) => ({
  activeSubagentId: null,
  setActiveSubagentId: (activeSubagentId) => set({ activeSubagentId }),
}));
