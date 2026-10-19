// Runs inside Electron, exercising the built main process, preload and utility server.
const { app, BrowserWindow, utilityProcess } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.AGENTCTL_SMOKE_OUTPUT;
const build = process.env.AGENTCTL_SMOKE_BUILD;
const failure = process.env.AGENTCTL_SMOKE_FAILURE === '1';
const children = [];
const originalFork = utilityProcess.fork;
utilityProcess.fork = (entry, args, options) => {
  const child = originalFork(
    failure ? path.join(process.cwd(), 'missing-server.cjs') : entry,
    args,
    options,
  );
  const record = { exited: false };
  child.once('exit', () => {
    record.exited = true;
  });
  children.push(record);
  return child;
};
app.setPath('userData', path.join(process.cwd(), 'electron-profile'));
// Protocol registration is an OS setting, outside this isolated smoke's scope.
app.setAsDefaultProtocolClient = () => true;
const report = {
  platform: process.platform,
  runtime: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    arch: process.arch,
  },
  failureScenario: failure,
  checks: {},
};
let completed = false;
const timer = setTimeout(() => fail(new Error('Native smoke timed out')), 45000);
function fail(error) {
  report.error = error.stack || String(error);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  app.exit(1);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.on('will-quit', () => {
  clearTimeout(timer);
  report.checks.oneServerOwner = children.length === 1;
  report.checks.serverExitedBeforeQuit = children.every((child) => child.exited);
  if (failure)
    report.checks.noWindowAfterStartupFailure = BrowserWindow.getAllWindows().length === 0;
  if (!failure && !completed) report.error = 'App quit before smoke completed';
  report.passed = !report.error && Object.values(report.checks).every(Boolean);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
});
if (!failure)
  app.once('browser-window-created', (_event, window) => {
    void (async () => {
      while (
        window.webContents.isLoading() ||
        !(await window.webContents.executeJavaScript('!!window.electronAPI').catch(() => false))
      )
        await sleep(100);
      const state = await window.webContents.executeJavaScript(`(async () => {
      const api = window.electronAPI;
      const port = await api.getServerPort();
      const secret = await api.getServerSecret();
      const controls = await api.getWindowControls();
      let calls = 0;
      const unsubscribe = api.onNavigate(() => calls++);
      unsubscribe(); unsubscribe();
      window.__nativeSmokeCalls = () => calls;
      api.onDeepLink(value => { window.__nativeSmokeLink = value; });
      api.updateTrayStatus({runningCount: 1, needsAttentionCount: 0});
      api.update.check();
      return {port, secretPresent: typeof secret === 'string' && secret.length > 0, controls: typeof controls.close === 'boolean', version: await api.getAppVersion()};
    })()`);
      report.checks.preloadContract =
        state.port > 0 && state.secretPresent && state.controls && !!state.version;
      app.emit('second-instance', {}, ['agentctl:///sessions/native-smoke']);
      await sleep(150);
      report.checks.deepLinkRoundTrip = await window.webContents.executeJavaScript(
        "window.__nativeSmokeLink === 'agentctl:///sessions/native-smoke'",
      );
      const response = await fetch(`http://127.0.0.1:${state.port}/api/auth/status`);
      report.checks.embeddedHttpServer = response.ok;
      window.webContents.send('navigate', '/sessions/smoke-disposed');
      await sleep(100);
      report.checks.disposedListener = await window.webContents.executeJavaScript(
        'window.__nativeSmokeCalls() === 0',
      );
      const outsider = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(build, 'preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      await outsider.loadURL('data:text/html,<title>IPC outsider</title>');
      report.checks.otherWindowDenied = await outsider.webContents.executeJavaScript(
        `window.electronAPI.getServerSecret().then(() => false, error => error.message.includes('Unauthorized'))`,
      );
      outsider.destroy();
      // Quit while the development updater timer is pending; shutdown must dispose it.
      completed = true;
      app.quit();
      app.quit();
    })().catch(fail);
  });
require(path.join(build, 'main/index.js'));
