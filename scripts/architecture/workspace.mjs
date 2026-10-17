import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ownershipErrors } from './ownership.mjs';

export async function repositoryFiles(workspace) {
  const { stdout } = await promisify(execFile)(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: workspace, encoding: 'utf8' },
  );
  const files = stdout.split('\0').filter(Boolean);
  const existing = await Promise.all(
    files.map(async (file) => {
      try {
        await access(join(workspace, file));
        return file;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }),
  );
  return [...new Set(existing.filter(Boolean))].sort();
}
export async function workspaceCoverageErrors(workspace) {
  const areas = [];
  for (const name of ['core', 'contracts', 'web', 'workspace']) {
    const ledger = JSON.parse(
      await readFile(join(workspace, `docs/${name}-ownership.json`), 'utf8'),
    );
    areas.push(...ledger.areas);
    for (const area of ledger.areas) await readFile(join(workspace, area.evidence), 'utf8');
  }
  const files = await repositoryFiles(workspace);
  return { errors: ownershipErrors(files, areas), count: files.length };
}
