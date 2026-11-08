import { ipcMain } from 'electron';
import { isTrustedSender } from './sender';

export function createTrustedIpcScope() {
  const disposers: (() => void)[] = [];
  const on: typeof ipcMain.on = (channel, listener) => {
    const guarded: typeof listener = (event, ...args) => {
      if (isTrustedSender(event)) listener(event, ...args);
    };
    ipcMain.on(channel, guarded);
    disposers.push(() => {
      ipcMain.removeListener(channel, guarded);
    });
    return ipcMain;
  };
  const handle: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
      return listener(event, ...args);
    });
    disposers.push(() => {
      ipcMain.removeHandler(channel);
    });
  };
  return {
    on,
    handle,
    dispose() {
      for (const unsubscribe of disposers.splice(0).reverse()) unsubscribe();
    },
  };
}
