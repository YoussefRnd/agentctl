import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ipcChannels } from '../ipcChannels';

import type { ElectronAPI, UpdateState } from '@agentctl/shared';

export type { ElectronAPI, UpdateState } from '@agentctl/shared';

function subscribe(channel: string, callback: (value: string) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (typeof value === 'string') callback(value);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: ElectronAPI = {
  getServerPort: () => ipcRenderer.invoke(ipcChannels.serverPort),
  getServerSecret: () => ipcRenderer.invoke(ipcChannels.serverSecret),
  getAppVersion: () => ipcRenderer.invoke(ipcChannels.appVersion),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onNavigate: (callback) => subscribe(ipcChannels.navigate, callback),
  onDeepLink: (callback) => {
    const dispose = subscribe(ipcChannels.deepLink, callback);
    ipcRenderer.send(ipcChannels.navigationReady);
    return dispose;
  },
  platform: process.platform,
  getWindowControls: () => ipcRenderer.invoke(ipcChannels.windowControls),
  win: {
    minimize: () => {
      ipcRenderer.send(ipcChannels.minimize);
    },
    maximize: () => {
      ipcRenderer.send(ipcChannels.maximize);
    },
    close: () => {
      ipcRenderer.send(ipcChannels.close);
    },
    isMaximized: () => ipcRenderer.invoke(ipcChannels.isMaximized),
    onMaximizeChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
        callback(isMaximized);
      };
      ipcRenderer.on(ipcChannels.maximizedChanged, listener);
      return () => {
        ipcRenderer.removeListener(ipcChannels.maximizedChanged, listener);
      };
    },
    openExternal: (url: string) => {
      ipcRenderer.send(ipcChannels.openExternal, url);
    },
    toggleDevTools: () => {
      ipcRenderer.send(ipcChannels.toggleDevTools);
    },
    toggleFullscreen: () => {
      ipcRenderer.send(ipcChannels.toggleFullscreen);
    },
    quit: () => {
      ipcRenderer.send(ipcChannels.quit);
    },
    reload: () => {
      ipcRenderer.send(ipcChannels.reload);
    },
  },
  edit: {
    undo: () => {
      ipcRenderer.send(ipcChannels.undo);
    },
    redo: () => {
      ipcRenderer.send(ipcChannels.redo);
    },
    cut: () => {
      ipcRenderer.send(ipcChannels.cut);
    },
    copy: () => {
      ipcRenderer.send(ipcChannels.copy);
    },
    paste: () => {
      ipcRenderer.send(ipcChannels.paste);
    },
    selectAll: () => {
      ipcRenderer.send(ipcChannels.selectAll);
    },
  },
  updateTrayStatus: (status) => {
    ipcRenderer.send(ipcChannels.updateTrayStatus, status);
  },
  update: {
    getState: () => ipcRenderer.invoke(ipcChannels.getUpdateState),
    onUpdate: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
        callback(state);
      };
      ipcRenderer.on(ipcChannels.updateState, listener);
      return () => {
        ipcRenderer.removeListener(ipcChannels.updateState, listener);
      };
    },
    check: () => {
      ipcRenderer.send(ipcChannels.checkForUpdate);
    },
    install: () => {
      ipcRenderer.send(ipcChannels.installUpdate);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
