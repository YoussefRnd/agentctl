import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { getMainWindow } from '../windows/mainWindow';

export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const contents = getMainWindow()?.webContents;
  return !!contents && event.sender === contents && event.senderFrame === contents.mainFrame;
}
