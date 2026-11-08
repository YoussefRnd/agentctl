import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ownershipErrors } from './ownership.mjs';

export const isSourceFile = (file) => /\.[cm]?[jt]sx?$/.test(file);
const isProductionFile = (file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

const scopedOwnership = {
  core: (file) =>
    file.startsWith('packages/core/src/') &&
    (isSourceFile(file) || file.includes('/skills/builtin/')),
  contracts: (file) => /^packages\/(?:shared|api-client)\/src\//.test(file) && isSourceFile(file),
  web: (file) => file.startsWith('apps/web/src/'),
};

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
  const files = await repositoryFiles(workspace);
  const production = files.filter(isProductionFile);
  const areas = [];
  const errors = [];
  for (const name of [...Object.keys(scopedOwnership), 'workspace']) {
    const ledger = JSON.parse(
      await readFile(join(workspace, `docs/${name}-ownership.json`), 'utf8'),
    );
    areas.push(...ledger.areas);
    const scope = scopedOwnership[name];
    if (scope) errors.push(...ownershipErrors(production.filter(scope), ledger.areas));
  }
  for (const evidence of new Set(areas.map((area) => area.evidence))) {
    if (evidence?.trim()) await readFile(join(workspace, evidence), 'utf8');
  }
  errors.push(...ownershipErrors(files, areas));
  return { errors, count: files.length };
}
