interface ElectronAPI {
  getServerPort: () => Promise<number>;
  getServerSecret: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  onNavigate: (callback: (path: string) => void) => void;
  onDeepLink: (callback: (url: string) => void) => void;
  platform: string;
  getWindowControls: () => Promise<{ minimize: boolean; maximize: boolean; close: boolean }>;
  win: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
    openExternal: (url: string) => void;
    toggleDevTools: () => void;
    toggleFullscreen: () => void;
    quit: () => void;
    reload: () => void;
  };
  edit: {
    undo: () => void;
    redo: () => void;
    cut: () => void;
    copy: () => void;
    paste: () => void;
    selectAll: () => void;
  };
  update: {
    getState: () => Promise<UpdateState>;
    onUpdate: (callback: (state: UpdateState) => void) => () => void;
    check: () => void;
    install: () => void;
  };
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'up-to-date' }
  | { status: 'error'; message: string };

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
