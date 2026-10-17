import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProviderLifecycleError } from './provider-lifecycle-error.js';
const execFilePromise = promisify(execFile);

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

export async function validateArchive(archivePath: string, signal?: AbortSignal): Promise<void> {
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

export async function extractArchive(
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
