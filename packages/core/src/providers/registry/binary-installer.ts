import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RegistryAgent, RegistryDistributionBinaryTarget } from '@agentctl/shared';
import { type Logger, noopLogger } from '../../logger.js';
import { ProviderLifecycleError } from './provider-lifecycle-error.js';

const execFilePromise = promisify(execFile);

export function getHome(): string {
  return process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl');
}

export function getPlatformKey(): string {
  const arch = os.arch();
  const platform = os.platform();
  const archMap: Record<string, string> = {
    x64: 'x86_64',
    arm64: 'aarch64',
    aarch64: 'aarch64',
  };
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  return `${platformMap[platform] ?? platform}-${archMap[arch] ?? arch}`;
}

function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertSafePathSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new ProviderLifecycleError('UNSAFE_ARCHIVE', `${label} is not a safe path segment`);
  }
}

function assertSafeArchiveEntry(entry: string): void {
  const normalized = entry.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new ProviderLifecycleError(
      'UNSAFE_ARCHIVE',
      `Archive contains an unsafe path: ${entry}`,
      { retryable: false },
    );
  }
}

async function validateArchive(archivePath: string, signal?: AbortSignal): Promise<void> {
  const lowercasePath = archivePath.toLowerCase();
  const isTar = lowercasePath.endsWith('.tar.gz') || lowercasePath.endsWith('.tgz');
  const listing = isTar
    ? await execFilePromise('tar', ['-tzf', archivePath], {
        maxBuffer: 10 * 1024 * 1024,
        signal,
      })
    : await execFilePromise('unzip', ['-Z1', archivePath], {
        maxBuffer: 10 * 1024 * 1024,
        signal,
      });
  for (const entry of listing.stdout.split(/\r?\n/).filter(Boolean)) assertSafeArchiveEntry(entry);

  const verbose = isTar
    ? await execFilePromise('tar', ['-tvzf', archivePath], {
        maxBuffer: 20 * 1024 * 1024,
        signal,
      })
    : await execFilePromise('unzip', ['-Z', '-l', archivePath], {
        maxBuffer: 20 * 1024 * 1024,
        signal,
      });
  if (verbose.stdout.split(/\r?\n/).some((line) => /^[lh]/.test(line.trimStart()))) {
    throw new ProviderLifecycleError(
      'UNSAFE_ARCHIVE',
      'Provider archives may not contain symbolic or hard links',
      { retryable: false },
    );
  }
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  signal?: AbortSignal,
): Promise<void> {
  const lowercasePath = archivePath.toLowerCase();
  if (lowercasePath.endsWith('.tar.gz') || lowercasePath.endsWith('.tgz')) {
    await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir], { signal });
  } else if (lowercasePath.endsWith('.zip')) {
    await execFilePromise('unzip', ['-o', archivePath, '-d', destDir], { signal });
  } else {
    // If not a tar.gz or zip, try tar, fallback to unzip
    try {
      await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir], { signal });
    } catch {
      await execFilePromise('unzip', ['-o', archivePath, '-d', destDir], { signal });
    }
  }
}

async function computeSha256(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest('hex');
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.cp(src, dest, { recursive: true });
}

export async function removeDirWithRetry(
  dir: string,
  options: { retries?: number; delays?: number[]; logger?: Pick<Logger, 'warn'> } = {},
): Promise<void> {
  const retries = options.retries ?? 3;
  const delays = options.delays ?? [0, 100, 200];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  options.logger?.warn(`Failed to remove directory after ${String(retries)} retries: ${dir}`);
  throw lastErr;
}

const UNSAFE_ARCHIVE_EXTENSIONS = new Set([
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.msi',
  '.appimage',
  '.tar.xz',
  '.txz',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
]);

export function isUnsafeArchiveType(archiveUrl: string): boolean {
  let lower: string;
  try {
    lower = new URL(archiveUrl).pathname.toLowerCase();
  } catch {
    return true;
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.zip')) {
    return false;
  }
  for (const ext of UNSAFE_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return true; // unknown extension -> treat as unsafe
}

export async function resolveGitHubSha256(
  archiveUrl: string,
  logger: Pick<Logger, 'warn'> = noopLogger,
  signal?: AbortSignal,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(archiveUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  // /<owner>/<repo>/releases/download/<tag>/<asset>
  if (parts.length < 6 || parts[2] !== 'releases' || parts[3] !== 'download') return null;
  const [owner, repo, , , tag] = parts;
  const asset = parts.slice(5).join('/');
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
      headers: { 'User-Agent': 'agentctl', Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { assets?: { name: string; digest?: string }[] };
    const match = (data.assets ?? []).find((a) => a.name === asset);
    if (!match?.digest) return null;
    const digest = match.digest.trim();
    const prefixed = /^sha256:([a-f0-9]{64})$/i.exec(digest);
    if (prefixed) return prefixed[1].toLowerCase();
    if (/^[a-f0-9]{64}$/i.test(digest)) return digest.toLowerCase();
    logger.warn(`Ignoring unsupported GitHub checksum format for ${archiveUrl}`);
    return null;
  } catch {
    if (signal?.aborted) throw signal.reason;
    logger.warn(`GitHub checksum lookup failed for ${archiveUrl}`);
    return null;
  }
}

export class BinaryInstaller {
  getInstallDir(providerId: string): string {
    assertSafePathSegment(providerId, 'Provider id');
    return path.join(getHome(), 'bin', providerId);
  }

  getVersionedInstallDir(providerId: string, version: string, archiveUrl: string): string {
    return path.join(
      this.getInstallDir(providerId),
      `v_${hashString(version)}_${hashString(archiveUrl)}`,
    );
  }

  getStagingDir(providerId: string): string {
    assertSafePathSegment(providerId, 'Provider id');
    return path.join(
      getHome(),
      'staging',
      `${providerId}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
    );
  }

  isInstalled(providerId: string, agent?: RegistryAgent, platform = getPlatformKey()): boolean {
    if (agent) {
      const target = agent.distribution.binary?.[platform];
      if (!target) return false;

      const versionedDir = this.getVersionedInstallDir(agent.id, agent.version, target.archive);
      const binaryPath = path.resolve(versionedDir, target.cmd);
      try {
        const stats = fs.statSync(binaryPath);
        return stats.isFile() && (process.platform === 'win32' || (stats.mode & 0o111) !== 0);
      } catch {
        return false;
      }
    }

    const base = this.getInstallDir(providerId);
    if (!fs.existsSync(base)) return false;
    const versions = fs.readdirSync(base).filter((e) => e.startsWith('v_'));
    return versions.some((e) => {
      const full = path.join(base, e);
      try {
        return fs.statSync(full).isDirectory() && fs.readdirSync(full).length > 0;
      } catch {
        return false;
      }
    });
  }

  async removeStaleVersionedDirs(
    providerId: string,
    currentVersionDir: string,
    logger: Pick<Logger, 'warn'> = noopLogger,
  ): Promise<void> {
    const base = this.getInstallDir(providerId);
    if (!fs.existsSync(base)) return;
    for (const entry of fs.readdirSync(base).filter((e) => e.startsWith('v_'))) {
      const full = path.join(base, entry);
      if (path.resolve(full) !== path.resolve(currentVersionDir)) {
        await removeDirWithRetry(full, { logger }).catch(() => undefined);
      }
    }
  }

  async removeVersionedDir(
    providerId: string,
    versionedDir: string,
    logger: Pick<Logger, 'warn'> = noopLogger,
  ): Promise<void> {
    const base = path.resolve(this.getInstallDir(providerId));
    const target = path.resolve(versionedDir);
    if (!target.startsWith(`${base}${path.sep}`)) {
      throw new Error('Refusing to remove a provider version outside its install directory');
    }
    await removeDirWithRetry(target, { logger });
  }

  async remove(providerId: string, logger: Pick<Logger, 'warn'> = noopLogger): Promise<void> {
    await removeDirWithRetry(this.getInstallDir(providerId), { logger });
    await this.removeStaging(providerId, logger);
  }

  async removeStaging(
    providerId: string,
    logger: Pick<Logger, 'warn'> = noopLogger,
  ): Promise<void> {
    assertSafePathSegment(providerId, 'Provider id');
    const stagingRoot = path.join(getHome(), 'staging');
    if (!fs.existsSync(stagingRoot)) return;
    const stagingName = new RegExp(`^${escapeRegExp(providerId)}-\\d+-[a-z0-9]+$`);
    for (const entry of fs.readdirSync(stagingRoot)) {
      if (stagingName.test(entry)) {
        await removeDirWithRetry(path.join(stagingRoot, entry), { logger });
      }
    }
  }

  async removeStaleStaging(
    logger: Pick<Logger, 'warn'> = noopLogger,
    olderThanMs = 60 * 60_000,
  ): Promise<void> {
    const stagingRoot = path.join(getHome(), 'staging');
    if (!fs.existsSync(stagingRoot)) return;
    for (const entry of fs.readdirSync(stagingRoot)) {
      const fullPath = path.join(stagingRoot, entry);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (Date.now() - stats.mtimeMs >= olderThanMs) {
          await removeDirWithRetry(fullPath, { logger });
        }
      } catch (error) {
        logger.warn({ error, entry }, 'Failed to inspect provider staging entry');
      }
    }
  }

  async install(
    agent: RegistryAgent,
    platform: string,
    logger: Pick<Logger, 'warn'> = noopLogger,
    options: {
      signal?: AbortSignal;
      onStage?: (stage: 'downloading' | 'verifying' | 'extracting' | 'activating') => void;
      onProgress?: (progress: { downloadedBytes: number; totalBytes: number | null }) => void;
      maxDownloadBytes?: number;
    } = {},
  ): Promise<{
    command: string;
    args: string[];
    env: Record<string, string>;
    versionedDir: string;
  }> {
    assertSafePathSegment(agent.id, 'Provider id');
    const binaryDist = agent.distribution.binary;
    const target: RegistryDistributionBinaryTarget | undefined = binaryDist
      ? binaryDist[platform]
      : undefined;
    if (!target) {
      throw new Error(`Platform ${platform} not supported for binary agent ${agent.id}`);
    }
    if (isUnsafeArchiveType(target.archive)) {
      throw new Error(
        `Unsupported/unsafe archive type for provider ${agent.id}: ${target.archive}`,
      );
    }

    const versionedDir = this.getVersionedInstallDir(agent.id, agent.version, target.archive);
    const stagingDir = this.getStagingDir(agent.id);

    const archiveUrl = target.archive;
    const parsedArchiveUrl = new URL(archiveUrl);
    if (parsedArchiveUrl.protocol !== 'https:') {
      throw new ProviderLifecycleError(
        'DOWNLOAD_FAILED',
        `Provider downloads must use HTTPS: ${archiveUrl}`,
        { retryable: false },
      );
    }

    const existingBinary = path.resolve(versionedDir, target.cmd);
    if (!existingBinary.startsWith(`${path.resolve(versionedDir)}${path.sep}`)) {
      throw new ProviderLifecycleError(
        'UNSAFE_ARCHIVE',
        'Provider command escapes install directory',
        {
          retryable: false,
        },
      );
    }
    try {
      const existing = await fs.promises.stat(existingBinary);
      if (existing.isFile() && (process.platform === 'win32' || (existing.mode & 0o111) !== 0)) {
        return {
          command: existingBinary,
          args: target.args ?? [],
          env: target.env,
          versionedDir,
        };
      }
    } catch {
      // A missing or incomplete target is replaced below without touching other versions.
    }

    options.onStage?.('downloading');
    let response: Response;
    try {
      response = await fetch(archiveUrl, { signal: options.signal, redirect: 'follow' });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ProviderLifecycleError('INSTALL_CANCELLED', 'Install cancelled', {
          cause: error,
        });
      }
      throw new ProviderLifecycleError('DOWNLOAD_FAILED', 'Failed to download provider archive', {
        cause: error,
      });
    }
    if (!response.ok || !response.body) {
      throw new ProviderLifecycleError(
        'DOWNLOAD_FAILED',
        `Failed to download binary archive: ${String(response.status)} ${response.statusText}`,
      );
    }
    if (response.url && new URL(response.url).protocol !== 'https:') {
      throw new ProviderLifecycleError(
        'DOWNLOAD_FAILED',
        'Provider download redirected to an insecure URL',
        { retryable: false },
      );
    }

    const maxDownloadBytes = options.maxDownloadBytes ?? 512 * 1024 * 1024;
    const contentLengthHeader = response.headers.get('content-length');
    const parsedContentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    const totalBytes =
      Number.isFinite(parsedContentLength) && parsedContentLength > 0 ? parsedContentLength : null;
    if (totalBytes !== null && totalBytes > maxDownloadBytes) {
      throw new ProviderLifecycleError(
        'DOWNLOAD_TOO_LARGE',
        `Provider archive exceeds the ${String(maxDownloadBytes)} byte limit`,
        { retryable: false },
      );
    }

    const urlPath = new URL(archiveUrl).pathname;
    const extension = urlPath.endsWith('.tar.gz') ? '.tar.gz' : path.extname(urlPath);
    const tempFile = path.join(
      os.tmpdir(),
      `${agent.id}-${String(Date.now())}${extension || '.archive'}`,
    );

    try {
      await fs.promises.mkdir(stagingDir, { recursive: true });

      try {
        let downloadedBytes = 0;
        let lastProgressAt = 0;
        options.onProgress?.({ downloadedBytes: 0, totalBytes });
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxDownloadBytes) {
              callback(
                new ProviderLifecycleError(
                  'DOWNLOAD_TOO_LARGE',
                  `Provider archive exceeds the ${String(maxDownloadBytes)} byte limit`,
                  { retryable: false },
                ),
              );
              return;
            }
            const now = Date.now();
            if (now - lastProgressAt >= 500) {
              lastProgressAt = now;
              options.onProgress?.({ downloadedBytes, totalBytes });
            }
            callback(null, chunk);
          },
        });
        try {
          await pipeline(
            Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
            limiter,
            fs.createWriteStream(tempFile),
            { signal: options.signal },
          );
        } catch (error) {
          if (options.signal?.aborted) {
            throw new ProviderLifecycleError('INSTALL_CANCELLED', 'Install cancelled', {
              cause: error,
            });
          }
          throw error;
        }

        options.onProgress?.({ downloadedBytes, totalBytes });
        options.onStage?.('verifying');
        const actualHash = await computeSha256(tempFile, options.signal);
        const configuredExpected = target.sha256?.trim().replace(/^sha256:/i, '');
        let expected = configuredExpected;
        if (!expected) {
          try {
            expected = (await resolveGitHubSha256(archiveUrl, logger, options.signal)) ?? undefined;
          } catch (error) {
            if (options.signal?.aborted) {
              throw new ProviderLifecycleError('INSTALL_CANCELLED', 'Install cancelled', {
                cause: error,
              });
            }
            throw error;
          }
        }
        if (expected && !/^[a-f0-9]{64}$/i.test(expected)) {
          throw new ProviderLifecycleError(
            'CHECKSUM_MISMATCH',
            `Invalid SHA-256 checksum configured for provider ${agent.id}`,
            { retryable: false },
          );
        }
        if (expected && expected.toLowerCase() !== actualHash.toLowerCase()) {
          throw new ProviderLifecycleError(
            'CHECKSUM_MISMATCH',
            `Checksum mismatch for provider ${agent.id}: expected ${expected}, got ${actualHash}`,
            { retryable: false },
          );
        }
        if (!expected) {
          logger.warn(`No checksum available for provider ${agent.id}; skipping verification`);
        }

        options.signal?.throwIfAborted();
        await validateArchive(tempFile, options.signal);
        options.onStage?.('extracting');
        options.signal?.throwIfAborted();
        await extractArchive(tempFile, stagingDir, options.signal);
      } finally {
        await fs.promises.unlink(tempFile).catch(() => undefined);
      }

      const stagedBinary = path.resolve(stagingDir, target.cmd);
      if (!stagedBinary.startsWith(`${path.resolve(stagingDir)}${path.sep}`)) {
        throw new ProviderLifecycleError(
          'UNSAFE_ARCHIVE',
          'Provider command escapes the extracted archive',
          { retryable: false },
        );
      }
      const stagedStats = await fs.promises.lstat(stagedBinary);
      if (!stagedStats.isFile() || stagedStats.isSymbolicLink()) {
        throw new ProviderLifecycleError(
          'UNSAFE_ARCHIVE',
          `Provider executable is not a regular file: ${target.cmd}`,
          { retryable: false },
        );
      }
      if (process.platform !== 'win32') await fs.promises.chmod(stagedBinary, 0o755);

      options.onStage?.('activating');
      options.signal?.throwIfAborted();
      await fs.promises.mkdir(path.dirname(versionedDir), { recursive: true });
      const backupDir = `${versionedDir}.backup-${crypto.randomUUID()}`;
      let hadPreviousTarget = false;
      try {
        try {
          await fs.promises.rename(versionedDir, backupDir);
          hadPreviousTarget = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        try {
          await fs.promises.rename(stagingDir, versionedDir);
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'EXDEV') throw err;
          const activationDir = `${versionedDir}.activating-${crypto.randomUUID()}`;
          try {
            await copyDir(stagingDir, activationDir);
            await fs.promises.rename(activationDir, versionedDir);
          } finally {
            await removeDirWithRetry(activationDir, { logger }).catch(() => undefined);
          }
        }

        const finalStats = await fs.promises.stat(existingBinary);
        if (
          !finalStats.isFile() ||
          (process.platform !== 'win32' && (finalStats.mode & 0o111) === 0)
        ) {
          throw new Error('Activated provider executable is not runnable');
        }
        if (hadPreviousTarget) {
          await removeDirWithRetry(backupDir, { logger }).catch((error: unknown) => {
            logger.warn({ error }, `Failed to remove provider backup directory: ${backupDir}`);
          });
        }
      } catch (err: unknown) {
        await removeDirWithRetry(versionedDir, { logger }).catch(() => undefined);
        if (hadPreviousTarget) {
          await fs.promises.rename(backupDir, versionedDir).catch(() => undefined);
        }
        throw new ProviderLifecycleError(
          'ACTIVATION_FAILED',
          `Failed to activate provider ${agent.id}`,
          { cause: err },
        );
      }
    } finally {
      await removeDirWithRetry(stagingDir, { logger }).catch(() => undefined);
      await fs.promises.rmdir(path.dirname(stagingDir)).catch(() => undefined);
    }

    return {
      command: existingBinary,
      args: target.args ?? [],
      env: target.env,
      versionedDir,
    };
  }
}
