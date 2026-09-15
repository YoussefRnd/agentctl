import { app, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { TrayStatus } from '../../shared/platform-types';
import { getMainWindow, createMainWindow } from '../windows/mainWindow';

let tray: Tray | null = null;
let trayStatus: TrayStatus = {
  runningCount: 0,
  needsAttentionCount: 0,
};

function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Fallback: 16x16 solid-color PNG data URL
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2NkYPj/n4EBBJgYKAEMFAMMFAEMFAMMFAEMFAMMFAEMFAMMFAEMFAMMFAAMFAMADP0L/wQnGGQAAAAASUVORK5CYII=',
  );
}

function openOrFocusMainWindow(): void {
  const win = getMainWindow();
  if (win) {
    win.show();
    win.focus();
  } else {
    createMainWindow();
  }
}

export function updateTrayMenu(): void {
  if (!tray) return;

  let tooltip = 'AgentCtl';
  if (trayStatus.runningCount > 0 || trayStatus.needsAttentionCount > 0) {
    const parts: string[] = [];
    if (trayStatus.runningCount > 0) {
      parts.push(`${String(trayStatus.runningCount)} running`);
    }
    if (trayStatus.needsAttentionCount > 0) {
      parts.push(`${String(trayStatus.needsAttentionCount)} waiting review`);
    }
    tooltip = `AgentCtl (${parts.join(', ')})`;
  }
  tray.setToolTip(tooltip);

  const menuItems: Electron.MenuItemConstructorOptions[] = [];

  if (trayStatus.runningCount > 0 || trayStatus.needsAttentionCount > 0) {
    if (trayStatus.runningCount > 0) {
      menuItems.push({
        label: `● ${String(trayStatus.runningCount)} session${trayStatus.runningCount > 1 ? 's' : ''} running`,
        enabled: false,
      });
    }
    if (trayStatus.needsAttentionCount > 0) {
      menuItems.push({
        label: `▲ ${String(trayStatus.needsAttentionCount)} waiting for review`,
        enabled: false,
      });
    }
    menuItems.push({ type: 'separator' });
  }

  menuItems.push(
    {
      label: 'Open AgentCtl',
      click: () => {
        openOrFocusMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(menuItems));
}

export function updateTrayStatus(status: TrayStatus): void {
  trayStatus = status;
  updateTrayMenu();
}

export function createTray(): void {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    updateTrayMenu();

    tray.on('double-click', () => {
      openOrFocusMainWindow();
    });
  } catch {
    // Tray not supported on this platform — skip gracefully
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
