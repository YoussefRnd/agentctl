import { app } from 'electron';
import { initAppLifecycle, setupApplicationMenu } from './lifecycle/appLifecycle';
import { createDesktopRuntime } from './lifecycle/desktopRuntime';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { createMainWindow } from './windows/mainWindow';
import { createTray, destroyTray } from './tray/trayManager';
import { startServer, stopServer, getServerPort } from './server/serverManager';
import { setupAutoUpdater, registerUpdateIpc } from './updates/updateManager';
import { reportDesktopPerformance } from './performance';

const runtime = createDesktopRuntime({
  startServer: async () => {
    const startedAt = performance.now();
    const port = await startServer((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      app.quit();
    });
    reportDesktopPerformance('desktop-server-start-to-ready', startedAt);
    process.stdout.write(`Server started on port ${String(port)}\n`);
    return port;
  },
  stopServer,
  openWindow: () => {
    createMainWindow();
  },
  setupResources: () => {
    const disposeIpc = registerIpcHandlers();
    const disposeUpdates = registerUpdateIpc();
    const disposeUpdater = setupAutoUpdater();
    createTray();
    return () => {
      destroyTray();
      disposeUpdater();
      disposeUpdates();
      disposeIpc();
    };
  },
});

if (
  initAppLifecycle(
    () => runtime.stop(),
    () => getServerPort() > 0,
  )
) {
  void app
    .whenReady()
    .then(async () => {
      reportDesktopPerformance('desktop-process-to-app-ready');
      setupApplicationMenu();
      await runtime.start();
    })
    .catch((error: unknown) => {
      process.stderr.write(`Desktop startup failed: ${String(error)}\n`);
      process.exitCode = 1;
      app.quit();
    });
}
