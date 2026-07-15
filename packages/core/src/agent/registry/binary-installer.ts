import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RegistryAgent, RegistryDistributionBinaryTarget } from '@agentctl/shared';
import { type Logger, noopLogger } from '../../logger.js';

const execFilePromise = promisify(execFile);

export function getHome(): string {
  return process.env.AGENTCTL_HOME ?? path.join(os.homedir(), '.agentctl');
}

function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const lowercasePath = archivePath.toLowerCase();
  if (lowercasePath.endsWith('.tar.gz') || lowercasePath.endsWith('.tgz')) {
    await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir]);
  } else if (lowercasePath.endsWith('.zip')) {
    await execFilePromise('unzip', ['-o', archivePath, '-d', destDir]);
  } else {
    // If not a tar.gz or zip, try tar, fallback to unzip
    try {
      await execFilePromise('tar', ['-xzf', archivePath, '-C', destDir]);
    } catch {
      await execFilePromise('unzip', ['-o', archivePath, '-d', destDir]);
    }
  }
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (c) => {
      hash.update(c);
    });
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
    stream.on('error', reject);
  });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.promises.copyFile(s, d);
  }
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
  const lower = archiveUrl.toLowerCase();
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
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { assets?: { name: string; digest?: string }[] };
    const match = (data.assets ?? []).find((a) => a.name === asset);
    if (!match?.digest) return null;
    return Buffer.from(match.digest, 'base64').toString('hex');
  } catch {
    logger.warn(`GitHub checksum lookup failed for ${archiveUrl}`);
    return null;
  }
}

export class BinaryInstaller {
  getInstallDir(providerId: string): string {
    return path.join(getHome(), 'bin', providerId);
  }

  getVersionedInstallDir(providerId: string, version: string, archiveUrl: string): string {
    return path.join(
      this.getInstallDir(providerId),
      `v_${hashString(version)}_${hashString(archiveUrl)}`,
    );
  }

  getStagingDir(providerId: string): string {
    return path.join(
      getHome(),
      'staging',
      `${providerId}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
    );
  }

  isInstalled(providerId: string): boolean {
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

  async remove(providerId: string, logger: Pick<Logger, 'warn'> = noopLogger): Promise<void> {
    await removeDirWithRetry(this.getInstallDir(providerId), { logger });
  }

  async install(
    agent: RegistryAgent,
    platform: string,
    logger: Pick<Logger, 'warn'> = noopLogger,
  ): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
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
    const response = await fetch(archiveUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download binary archive: ${response.statusText}`);
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
        await pipeline(
          Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
          fs.createWriteStream(tempFile),
        );
        await extractArchive(tempFile, stagingDir);

        const binaryPath = path.resolve(stagingDir, target.cmd);
        const actualHash = await computeSha256(binaryPath);
        const expected = target.sha256 ?? (await resolveGitHubSha256(archiveUrl, logger));
        if (expected && expected.toLowerCase() !== actualHash.toLowerCase()) {
          throw new Error(
            `Checksum mismatch for provider ${agent.id}: expected ${expected}, got ${actualHash}`,
          );
        }
        if (!expected) {
          logger.warn(`No checksum available for provider ${agent.id}; skipping verification`);
        }
      } finally {
        await fs.promises.unlink(tempFile).catch(() => undefined);
      }

      await removeDirWithRetry(this.getInstallDir(agent.id), { logger });
      await fs.promises.mkdir(path.dirname(versionedDir), { recursive: true });
      try {
        await fs.promises.rename(stagingDir, versionedDir);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EXDEV') {
          await copyDir(stagingDir, versionedDir);
        } else {
          throw err;
        }
      }
    } finally {
      await removeDirWithRetry(stagingDir, { logger }).catch(() => undefined);
      await fs.promises.rmdir(path.dirname(stagingDir)).catch(() => undefined);
    }

    const finalBinary = path.resolve(versionedDir, target.cmd);
    if (process.platform !== 'win32') {
      await fs.promises.chmod(finalBinary, 0o755).catch(() => undefined);
    }

    void this.removeStaleVersionedDirs(agent.id, versionedDir, logger).catch(() => undefined);

    return { command: finalBinary, args: target.args ?? [], env: target.env };
  }
}
