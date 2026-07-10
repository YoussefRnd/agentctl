import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
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
  win: {
    minimize: () => {
      ipcRenderer.send('win:minimize');
    },
    maximize: () => {
      ipcRenderer.send('win:maximize');
    },
    close: () => {
      ipcRenderer.send('win:close');
    },
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizeChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
        callback(isMaximized);
      };
      ipcRenderer.on('win:maximized-changed', listener);
      return () => {
        ipcRenderer.removeListener('win:maximized-changed', listener);
      };
    },
    openExternal: (url: string) => {
      ipcRenderer.send('win:open-external', url);
    },
    toggleDevTools: () => {
      ipcRenderer.send('win:toggle-devtools');
    },
    reload: () => {
      ipcRenderer.send('win:reload');
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
