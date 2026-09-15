import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { ElectronAPI, UpdateState } from './contracts';

export type { ElectronAPI, UpdateState } from './contracts';

const api: ElectronAPI = {
  getServerPort: () => ipcRenderer.invoke('server:get-port'),
  getServerSecret: () => ipcRenderer.invoke('server:get-secret'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
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
  getWindowControls: () => ipcRenderer.invoke('win:get-controls'),
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
    toggleFullscreen: () => {
      ipcRenderer.send('win:toggle-fullscreen');
    },
    quit: () => {
      ipcRenderer.send('app:quit');
    },
    reload: () => {
      ipcRenderer.send('win:reload');
    },
  },
  edit: {
    undo: () => {
      ipcRenderer.send('edit:undo');
    },
    redo: () => {
      ipcRenderer.send('edit:redo');
    },
    cut: () => {
      ipcRenderer.send('edit:cut');
    },
    copy: () => {
      ipcRenderer.send('edit:copy');
    },
    paste: () => {
      ipcRenderer.send('edit:paste');
    },
    selectAll: () => {
      ipcRenderer.send('edit:select-all');
    },
  },
  updateTrayStatus: (status) => {
    ipcRenderer.send('tray:update-status', status);
  },
  update: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    onUpdate: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
        callback(state);
      };
      ipcRenderer.on('update:state', listener);
      return () => {
        ipcRenderer.removeListener('update:state', listener);
      };
    },
    check: () => {
      ipcRenderer.send('update:check');
    },
    install: () => {
      ipcRenderer.send('update:install');
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
