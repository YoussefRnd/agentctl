import type { simpleGit } from 'simple-git';
import type { ReviewFile } from './utils.js';
import type { FilePatch, SnapshotFileChange, SnapshotComparison } from './snapshot-types.js';
interface TreeEntry {
  mode: string;
  size: number;
}

/** Reads pinned tree objects; owns no mutable index, capture lock, or retention refs. */
export class GitSnapshotComparison {
  constructor(private readonly maxDiffBytes: number) {}
  async compareTrees(
    git: ReturnType<typeof simpleGit>,
    fromTree: string,
    toTree: string,
    filePath?: string,
  ): Promise<SnapshotComparison> {
    if (fromTree === toTree) return { files: [], totalAdditions: 0, totalDeletions: 0 };
    const [statusOutput, numstatOutput] = await Promise.all([
      git.raw([
        '--literal-pathspecs',
        'diff-tree',
        '-r',
        '--no-commit-id',
        '--no-renames',
        '--name-status',
        '-z',
        fromTree,
        toTree,
        ...(filePath ? ['--', filePath] : []),
      ]),
      git.raw([
        '--literal-pathspecs',
        'diff-tree',
        '-r',
        '--no-commit-id',
        '--no-renames',
        '--numstat',
        '-z',
        fromTree,
        toTree,
        ...(filePath ? ['--', filePath] : []),
      ]),
    ]);

    const statuses = new Map<string, FilePatch['status']>();
    const statusFields = statusOutput.split('\0');
    for (let index = 0; index + 1 < statusFields.length; index += 2) {
      const statusCode = statusFields[index];
      const filePath = statusFields[index + 1];
      if (!statusCode || !filePath) continue;
      statuses.set(
        filePath,
        statusCode === 'A' ? 'added' : statusCode === 'D' ? 'deleted' : 'modified',
      );
    }

    const files: SnapshotFileChange[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const record of numstatOutput.split('\0')) {
      if (!record) continue;
      const firstTab = record.indexOf('\t');
      const secondTab = record.indexOf('\t', firstTab + 1);
      if (firstTab < 0 || secondTab < 0) continue;
      const additionsText = record.slice(0, firstTab);
      const deletionsText = record.slice(firstTab + 1, secondTab);
      const filePath = record.slice(secondTab + 1);
      const additions = additionsText === '-' ? 0 : Number.parseInt(additionsText, 10);
      const deletions = deletionsText === '-' ? 0 : Number.parseInt(deletionsText, 10);
      const change = {
        path: filePath,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
        status: statuses.get(filePath) ?? 'modified',
      } satisfies SnapshotFileChange;
      files.push(change);
      totalAdditions += change.additions;
      totalDeletions += change.deletions;
    }

    return { files, totalAdditions, totalDeletions };
  }

  async treeEntries(
    git: ReturnType<typeof simpleGit>,
    tree: string,
    paths: string[],
  ): Promise<Map<string, TreeEntry>> {
    const entries = new Map<string, TreeEntry>();
    if (paths.length === 0) return entries;
    const output = await git.raw([
      '--literal-pathspecs',
      'ls-tree',
      '-r',
      '-l',
      '-z',
      tree,
      '--',
      ...paths,
    ]);
    for (const record of output.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab < 0) continue;
      const [mode, , , size] = record.slice(0, tab).trim().split(/\s+/);
      entries.set(record.slice(tab + 1), { mode, size: size === '-' ? 0 : Number(size) });
    }
    return entries;
  }

  async fillDiffs(
    git: ReturnType<typeof simpleGit>,
    fromTree: string,
    toTree: string,
    files: ReviewFile[],
  ): Promise<void> {
    const paths = files.map((file) => file.path);
    const [before, after] = await Promise.all([
      this.treeEntries(git, fromTree, paths),
      this.treeEntries(git, toTree, paths),
    ]);
    for (const file of files) {
      if (before.get(file.path)?.mode === '160000' || after.get(file.path)?.mode === '160000') {
        file.diff = 'Nested repository; review its changes in that repository.';
      } else if (
        Math.max(before.get(file.path)?.size ?? 0, after.get(file.path)?.size ?? 0) >
        this.maxDiffBytes
      ) {
        file.diff = 'Diff omitted: exceeds the configured size limit. Open it in the editor.';
      } else {
        const diff = await git.raw([
          '--literal-pathspecs',
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          fromTree,
          toTree,
          '--',
          file.path,
        ]);
        file.diff =
          Buffer.byteLength(diff) > this.maxDiffBytes
            ? 'Diff omitted: exceeds the configured size limit. Open it in the editor.'
            : diff;
      }
    }
  }
}
