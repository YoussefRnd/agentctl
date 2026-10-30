import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  RepositoryTextSnapshot,
  SnapshotFileEntry,
  SnapshotTextFile,
} from '../repository/types.js';
const exec = promisify(execFile);
const safePath = (path: string) =>
  !!path &&
  !path.includes('\0') &&
  !path.includes('\\') &&
  !path.startsWith('/') &&
  !/^[a-z]:/i.test(path) &&
  !path.split('/').some((part) => part === '..' || part === '.');

/** Reads Git objects only. No checkout, filters, hooks, executable scripts or symlink targets. */
export class GitTextSnapshot implements RepositoryTextSnapshot {
  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string>,
    private readonly tree: string,
  ) {
    if (!/^[0-9a-f]{40,64}$/i.test(tree)) throw new Error('Invalid snapshot tree');
  }
  private async command(args: string[], maxBuffer: number, partial = false, signal?: AbortSignal) {
    try {
      const { stdout } = await exec('git', args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        timeout: 5000,
        maxBuffer,
        signal,
        encoding: 'buffer',
      });
      return { bytes: stdout, truncated: false };
    } catch (error) {
      const failure = error as { code?: string | number; stdout?: Buffer };
      if (failure.code === 1 && args[0] === 'grep')
        return { bytes: Buffer.alloc(0), truncated: false };
      if (
        partial &&
        failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' &&
        Buffer.isBuffer(failure.stdout)
      )
        return { bytes: failure.stdout, truncated: true };
      throw error;
    }
  }
  private entries(bytes: Buffer) {
    // A bounded command can end inside a record; only complete NUL records count.
    return bytes
      .toString('utf8')
      .split('\0')
      .slice(0, -1)
      .flatMap((record) => {
        const tab = record.indexOf('\t');
        if (tab < 0) return [];
        const [mode, type, oid, size] = record.slice(0, tab).trim().split(/\s+/);
        const path = record.slice(tab + 1);
        if (!safePath(path) || !/^[0-9a-f]{40,64}$/i.test(oid ?? '')) return [];
        const kind =
          mode === '120000'
            ? 'symlink'
            : mode === '160000'
              ? 'submodule'
              : type === 'blob' && ['100644', '100755'].includes(mode)
                ? 'file'
                : null;
        return kind
          ? [
              { path, size: size === '-' ? 0 : Number(size), kind, oid } as SnapshotFileEntry & {
                oid: string;
              },
            ]
          : [];
      });
  }
  async listFiles(limit: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
      throw new Error('Invalid snapshot file limit');
    const result = await this.command(
      ['ls-tree', '-r', '-l', '-z', this.tree],
      2 * 1024 * 1024,
      true,
      signal,
    );
    const files = this.entries(result.bytes);
    return {
      files: files.slice(0, limit).map(({ path, size, kind }) => ({ path, size, kind })),
      truncated: result.truncated || files.length > limit,
    };
  }
  async readFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<SnapshotTextFile> {
    if (!safePath(path)) throw new Error('Snapshot paths must be workspace-relative');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024)
      throw new Error('Invalid snapshot byte limit');
    const meta = await this.command(
      ['--literal-pathspecs', 'ls-tree', '-r', '-l', '-z', this.tree, '--', path],
      32_768,
      false,
      signal,
    );
    const entry = this.entries(meta.bytes).find((entry) => entry.path === path);
    if (!entry) return { status: 'missing' };
    if (entry.kind !== 'file') return { status: entry.kind };
    if (!Number.isSafeInteger(entry.size) || entry.size > maxBytes) return { status: 'too_large' };
    const { bytes } = await this.command(
      ['cat-file', 'blob', entry.oid],
      maxBytes + 1,
      false,
      signal,
    );
    if (bytes.includes(0)) return { status: 'binary' };
    try {
      return { status: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      return { status: 'binary' };
    }
  }
  async search(terms: string[], limit: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new Error('Invalid reference search limit');
    const needles = [...new Set(terms.filter((term) => /^[\w./@-]{3,100}$/.test(term)))].slice(
      0,
      24,
    );
    if (!needles.length) return { paths: [], truncated: false };
    const result = await this.command(
      [
        'grep',
        '--no-color',
        '--no-recurse-submodules',
        '--no-textconv',
        '-F',
        '-I',
        '-l',
        '-z',
        ...needles.flatMap((term) => ['-e', term]),
        this.tree,
        '--',
      ],
      256 * 1024,
      true,
      signal,
    );
    const prefix = `${this.tree}:`;
    const paths = result.bytes
      .toString('utf8')
      .split('\0')
      .slice(0, -1)
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter(safePath);
    return { paths: paths.slice(0, limit), truncated: result.truncated || paths.length > limit };
  }
}
