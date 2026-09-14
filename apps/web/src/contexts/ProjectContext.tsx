import { createContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { projectStore, type ProjectSettings } from '../shared/stores/project-store.js';

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

  const value = useMemo<ProjectContextValue>(
    () => ({
      activeId: state.activeId,
      settings: state.settings,
      setActiveId: (id) => {
        projectStore.setActiveId(id);
      },
      setSettings: (settings) => {
        projectStore.setSettings(settings);
      },
    }),
    [state.activeId, state.settings],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
