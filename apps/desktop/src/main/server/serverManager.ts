import { utilityProcess } from 'electron';
import path from 'node:path';
import { isReadyMessage, shutdownMessage } from './serverProtocol';

let serverProcess: Electron.UtilityProcess | null = null;
let serverPort = 0;
let serverSecret = '';
let startPromise: Promise<number> | null = null;
let cancelStart: ((error: Error) => void) | null = null;
let stopPromise: Promise<void> | null = null;

function formatJsonLog(line: string): string {
  try {
    const parsed = JSON.parse(line) as {
      level?: number;
      time?: number;
      msg?: string;
      err?: { message?: string; stack?: string };
      [key: string]: unknown;
    };

    if (typeof parsed.level === 'number' && parsed.msg) {
      let levelLabel = 'INFO';
      let color = '\x1b[32m'; // Green
      if (parsed.level === 20) {
        levelLabel = 'DEBUG';
        color = '\x1b[36m'; // Cyan
      } else if (parsed.level === 40) {
        levelLabel = 'WARN';
        color = '\x1b[33m'; // Yellow
      } else if (parsed.level >= 50) {
        levelLabel = 'ERROR';
        color = '\x1b[31m'; // Red
      }

      const reset = '\x1b[0m';
      const timeStr = parsed.time ? new Date(parsed.time).toLocaleTimeString() : '';
      const timePart = timeStr ? `[${timeStr}] ` : '';

      let logLine = `${timePart}${color}${levelLabel}${reset}: ${parsed.msg}`;

      const extra = { ...parsed };
      delete extra.level;
      delete extra.time;
      delete extra.msg;
      delete extra.err;

      if (Object.keys(extra).length > 0) {
        const extraLines = JSON.stringify(extra, null, 2)
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
        logLine += `\n${extraLines}\n`;
      } else {
        logLine += '\n';
      }

      if (parsed.err) {
        if (parsed.err.message) {
          logLine += `  ${color}Error:${reset} ${parsed.err.message}\n`;
        }
        if (parsed.err.stack) {
          logLine += `  ${parsed.err.stack}\n`;
        }
      }
      return logLine;
    }
  } catch {}
  return line + '\n';
}

export function startServer(onUnexpectedExit?: (error: Error) => void): Promise<number> {
  if (stopPromise) return stopPromise.then(() => startServer(onUnexpectedExit));
  if (startPromise) return startPromise;
  if (serverProcess && serverPort) return Promise.resolve(serverPort);
  if (serverProcess) return stopServer().then(() => startServer(onUnexpectedExit));
  const starting = new Promise<number>((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'server-process.js'), [], {
      stdio: 'pipe',
    });
    serverProcess = child;
    let settled = false;
    let readyReceived = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('message', ready);
      reject(error);
    };
    cancelStart = fail;
    const timeout = setTimeout(() => {
      fail(new Error('Server failed to start within 15 seconds'));
      child.kill();
    }, 15_000);
    const ready = (message: unknown) => {
      if (!isReadyMessage(message) || settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('message', ready);
      readyReceived = true;
      serverPort = message.port;
      serverSecret = message.secret;
      resolve(message.port);
    };
    child.on('message', ready);
    child.once('exit', (code) => {
      const unexpected = readyReceived && serverPort !== 0;
      fail(new Error(`Server process exited before ready (code ${String(code)})`));
      if (serverProcess === child) {
        serverProcess = null;
        serverPort = 0;
        serverSecret = '';
      }
      if (unexpected)
        onUnexpectedExit?.(new Error(`Embedded server exited unexpectedly (code ${String(code)})`));
    });
    for (const [stream, output] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ] as const) {
      let buffer = '';
      stream?.on('data', (chunk: Buffer) => {
        const lines = (buffer + chunk.toString()).split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) output.write(formatJsonLog(line));
      });
      stream?.once('end', () => {
        if (buffer.trim()) output.write(formatJsonLog(buffer));
      });
    }
  });
  startPromise = starting.finally(() => {
    startPromise = null;
    cancelStart = null;
  });
  return startPromise;
}

export function stopServer(): Promise<void> {
  if (stopPromise) return stopPromise;
  cancelStart?.(new Error('Server startup cancelled by shutdown'));
  serverPort = 0;
  serverSecret = '';
  const child = serverProcess;
  if (!child) return Promise.resolve();

  const stopping = new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.removeListener('exit', finish);
      if (serverProcess === child) serverProcess = null;
      resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish();
    }, 4_500);
    timeout.unref();
    child.once('exit', finish);

    try {
      child.postMessage(shutdownMessage);
    } catch {
      // The utility process may have exited before receiving the message.
      child.kill();
      finish();
    }
  });
  stopPromise = stopping.finally(() => {
    stopPromise = null;
  });
  return stopPromise;
}

export function getServerPort(): number {
  return serverPort;
}

export function getServerSecret(): string {
  return serverSecret;
}
