import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { projectStore, type ProjectSettings } from '@agentctl/shared';

interface ProjectContextValue {
  activeId: string | null;
  settings: ProjectSettings;
  setActiveId: (id: string | null) => void;
  setSettings: (settings: Partial<ProjectSettings>) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    (listener) => projectStore.subscribe(listener),
    () => projectStore.getState(),
  );

  const value: ProjectContextValue = {
    activeId: state.activeId,
    settings: state.settings,
    setActiveId: (id) => {
      projectStore.setActiveId(id);
    },
    setSettings: (settings) => {
      projectStore.setSettings(settings);
    },
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectStore() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjectStore must be used within a ProjectProvider');
  }
  return context;
}
