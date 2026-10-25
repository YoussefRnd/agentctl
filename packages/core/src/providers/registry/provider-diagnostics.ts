import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  diagnosticError,
  OperationDiagnostics,
  redactDiagnosticText,
} from '../../agent/operation-diagnostics.js';
import type { Logger } from '../../logger.js';
import { getHome } from './binary-installer.js';

const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_FILES = 5;
const MAX_FAILURES = 20;
// Serialize retention and writing so concurrent provider failures cannot prune each other.
let pending: Promise<unknown> = Promise.resolve();

export function getNpmCache(environment: Record<string, string | undefined>): string {
  return (
    environment.npm_config_cache ??
    environment.NPM_CONFIG_CACHE ??
    process.env.npm_config_cache ??
    process.env.NPM_CONFIG_CACHE ??
    (process.platform === 'win32'
      ? path.join(
          process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
          'npm-cache',
        )
      : path.join(os.homedir(), '.npm'))
  );
}

/** Preserve small, redacted failure evidence before candidate caches are discarded. */
export async function preserveProviderFailure(options: {
  trace: OperationDiagnostics;
  providerId: string;
  version?: string | null;
  installSource?: string | null;
  error: unknown;
  npmCache?: string;
  environment?: Record<string, string | undefined>;
  logger: Logger;
}): Promise<string | undefined> {
  const snapshot = options.trace.finish('error');
  const root = path.join(getHome(), 'diagnostics', 'providers');
  const environment = { ...process.env, ...options.environment };
  const reportError = diagnosticError(options.error, environment);
  const save = async () => {
    const savedAt = new Date().toISOString();
    const directory = path.join(root, `${savedAt.replace(/[:.]/g, '-')}-${snapshot.operationId}`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const npmLogs: string[] = [];
      const processLogs: string[] = [];
      if (options.error && typeof options.error === 'object') {
        const output = options.error as { stdout?: unknown; stderr?: unknown };
        for (const stream of ['stdout', 'stderr'] as const) {
          const value = output[stream];
          if (typeof value !== 'string' && !Buffer.isBuffer(value)) continue;
          const content = redactDiagnosticText(String(value), environment);
          const filename = `process-${stream}.log`;
          await fs.writeFile(
            path.join(directory, filename),
            Buffer.from(content).subarray(-MAX_LOG_BYTES),
            { mode: 0o600 },
          );
          processLogs.push(filename);
        }
      }
      const npmLogSources: Record<string, string> = {};
      let npmLogError: Record<string, unknown> | undefined;
      if (options.npmCache) {
        try {
          const logRoot = path.join(options.npmCache, '_logs');
          const entries = await fs.readdir(logRoot, { withFileTypes: true });
          const names = entries
            .filter((e) => e.isFile() && e.name.endsWith('.log'))
            .map((e) => e.name)
            .sort()
            .reverse()
            .slice(0, MAX_LOG_FILES);
          for (const [index, name] of names.entries()) {
            const file = await fs.open(
              path.join(logRoot, name),
              constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
            );
            let text: string;
            try {
              const stat = await file.stat();
              if (!stat.isFile()) continue;
              const start = Math.max(0, stat.size - MAX_LOG_BYTES);
              const buffer = Buffer.alloc(Math.min(stat.size, MAX_LOG_BYTES));
              const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
              text = buffer.subarray(0, bytesRead).toString('utf8');
              // Drop a partial first line rather than retaining a fragment of a secret.
              if (start > 0) {
                const newline = text.indexOf('\n');
                text =
                  '[earlier log content omitted]\n' + (newline < 0 ? '' : text.slice(newline + 1));
              }
            } finally {
              await file.close();
            }
            const outputName = `npm-${index + 1}.log`;
            await fs.writeFile(
              path.join(directory, outputName),
              Buffer.from(redactDiagnosticText(text, environment)).subarray(0, MAX_LOG_BYTES),
              { mode: 0o600 },
            );
            npmLogs.push(outputName);
            npmLogSources[outputName] = redactDiagnosticText(name, environment);
          }
        } catch (error) {
          npmLogError = diagnosticError(error, environment);
        }
      }
      const report = {
        ...snapshot,
        savedAt,
        providerId: redactDiagnosticText(options.providerId, environment),
        version: options.version ? redactDiagnosticText(options.version, environment) : null,
        installSource: options.installSource,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        error: reportError,
        npmLogs,
        processLogs,
        npmLogSources,
        npmCache: options.npmCache
          ? redactDiagnosticText(options.npmCache, environment)
          : undefined,
        npmLogError,
      };
      const reportPath = path.join(directory, 'report.json');
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
      options.logger.warn(
        {
          providerId: options.providerId,
          operationId: snapshot.operationId,
          reportPath,
          error: reportError,
        },
        'Provider failure diagnostics saved',
      );
      const entries = await fs.readdir(root, { withFileTypes: true });
      const old = entries
        .filter(
          (e) =>
            e.isDirectory() &&
            path.join(root, e.name) !== directory &&
            /^\d{4}-\d{2}-\d{2}T.*-[a-f0-9-]{36}$/.test(e.name),
        )
        .map((e) => e.name)
        .sort()
        .reverse()
        .slice(MAX_FAILURES - 1);
      for (const name of old) await fs.rm(path.join(root, name), { recursive: true, force: true });
      return reportPath;
    } catch (error) {
      options.logger.warn(
        { providerId: options.providerId, error: diagnosticError(error, environment) },
        'Failed to save provider diagnostics',
      );
      return undefined;
    }
  };
  const result = pending.then(save, save);
  pending = result;
  return result;
}
