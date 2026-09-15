import { app } from 'electron';
import { initAppLifecycle, setupApplicationMenu } from './lifecycle/appLifecycle';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { createMainWindow } from './windows/mainWindow';
import { createTray } from './tray/trayManager';
import { startServer } from './server/serverManager';
import { setupAutoUpdater, registerUpdateIpc } from './updates/updateManager';

// Register IPC handlers early so the renderer can query window controls upon connect
registerIpcHandlers();

if (initAppLifecycle()) {
  void app.whenReady().then(async () => {
    setupApplicationMenu();

    try {
      const serverPort = await startServer();
      process.stdout.write(`Server started on port ${serverPort.toString()}\n`);
    } catch (err) {
      process.stderr.write(`Failed to start server: ${String(err)}\n`);
      app.quit();
      return;
    }

    createMainWindow();
    createTray();

    // Auto-updater — listeners always active; initial check only in production builds
    registerUpdateIpc();
    setupAutoUpdater();
  });
}
