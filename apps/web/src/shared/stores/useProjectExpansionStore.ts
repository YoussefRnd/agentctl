import { create } from 'zustand';

interface ProjectExpansionState {
  collapsedProjects: Record<string, boolean>;
  setProjectCollapsed: (projectId: string, collapsed: boolean) => void;
  keepProjectExpanded: (projectId: string) => void;
}

export const useProjectExpansionStore = create<ProjectExpansionState>((set) => ({
  collapsedProjects: {},
  setProjectCollapsed: (projectId, collapsed) =>
    set((state) => ({
      collapsedProjects: { ...state.collapsedProjects, [projectId]: collapsed },
    })),
  keepProjectExpanded: (projectId) =>
    set((state) => ({
      collapsedProjects:
        state.collapsedProjects[projectId] === undefined
          ? { ...state.collapsedProjects, [projectId]: false }
          : state.collapsedProjects,
    })),
}));
