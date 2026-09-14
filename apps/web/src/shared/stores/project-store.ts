type Listener<T> = (state: T) => void;

export interface ProjectSettings {
  sortBy: 'lastActive' | 'name' | 'createdAt';
  gitOnly: boolean;
  showArchived: boolean;
}

export interface ProjectState {
  activeId: string | null;
  settings: ProjectSettings;
}

export class ProjectStore {
  private state: ProjectState = {
    activeId: null,
    settings: {
      sortBy: 'lastActive',
      gitOnly: false,
      showArchived: false,
    },
  };

  private listeners = new Set<Listener<ProjectState>>();

  getState(): ProjectState {
    return this.state;
  }

  setActiveId(id: string | null): void {
    this.state = {
      ...this.state,
      activeId: id,
    };
    this.notify();
  }

  setSettings(settings: Partial<ProjectSettings>): void {
    this.state = {
      ...this.state,
      settings: { ...this.state.settings, ...settings },
    };
    this.notify();
  }

  subscribe(listener: Listener<ProjectState>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      listener(currentState);
    });
  }
}

export const projectStore = new ProjectStore();
