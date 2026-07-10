interface ElectronAPI {
  getServerPort: () => Promise<number>;
  getServerSecret: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  onNavigate: (callback: (path: string) => void) => void;
  onDeepLink: (callback: (url: string) => void) => void;
  platform: string;
  win: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
    openExternal: (url: string) => void;
    toggleDevTools: () => void;
    reload: () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
