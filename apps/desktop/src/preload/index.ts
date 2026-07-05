import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  getServerPort: () => Promise<number>;
  getServerSecret: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  onNavigate: (callback: (path: string) => void) => void;
  onDeepLink: (callback: (url: string) => void) => void;
  platform: string;
}

const api: ElectronAPI = {
  getServerPort: () => ipcRenderer.invoke('server:get-port'),
  getServerSecret: () => ipcRenderer.invoke('server:get-secret'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (_event, path: string) => {
      callback(path);
    });
  },
  onDeepLink: (callback) => {
    ipcRenderer.on('deep-link', (_event, url: string) => {
      callback(url);
    });
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('electronAPI', api);
