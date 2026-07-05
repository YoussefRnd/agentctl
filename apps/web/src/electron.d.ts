interface ElectronAPI {
  getServerPort: () => Promise<number>;
  getServerSecret: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  onNavigate: (callback: (path: string) => void) => void;
  onDeepLink: (callback: (url: string) => void) => void;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
