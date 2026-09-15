import { utilityProcess } from 'electron';
import path from 'node:path';
import type { ReadyMessage } from '../../shared/platform-types';

let serverProcess: Electron.UtilityProcess | null = null;
let serverPort = 0;
let serverSecret = '';

export function formatJsonLog(line: string): string {
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

      // Extract all extra keys (like req, res, responseTime) to print them
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
  } catch {
    // not JSON
  }
  return line + '\n';
}

export function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverEntry = path.join(__dirname, 'server-process.js');
    serverProcess = utilityProcess.fork(serverEntry, [], { stdio: 'pipe' });

    let stdoutBuffer = '';
    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          process.stdout.write(formatJsonLog(line));
        }
      }
    });

    let stderrBuffer = '';
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          process.stderr.write(formatJsonLog(line));
        }
      }
    });

    const timeout = setTimeout(() => {
      reject(new Error('Server failed to start within 15 seconds'));
    }, 15_000);

    serverProcess.on('message', (msg: unknown) => {
      const isReadyMsg = (m: unknown): m is ReadyMessage => {
        return (
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as Record<string, unknown>).type === 'ready' &&
          'port' in m &&
          typeof (m as Record<string, unknown>).port === 'number'
        );
      };

      if (isReadyMsg(msg)) {
        clearTimeout(timeout);
        serverPort = msg.port;
        serverSecret = msg.secret;
        resolve(msg.port);
      }
    });

    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Server process exited with code ${String(code)}`));
      }
    });
  });
}

export function stopServer(): void {
  if (serverProcess) {
    try {
      serverProcess.postMessage({ type: 'shutdown' });
    } catch {
      // process may have already exited
    }
    serverProcess.kill();
    serverProcess = null;
  }
}

export function getServerPort(): number {
  return serverPort;
}

export function getServerSecret(): string {
  return serverSecret;
}
