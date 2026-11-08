import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isSourceFile, workspaceCoverageErrors } from './architecture/workspace.mjs';
import { packageSurfaces } from './architecture/public-api.mjs';

const rootIndex = process.argv.indexOf('--root');
const workspace =
  rootIndex >= 0 ? resolve(process.argv[rootIndex + 1]) : resolve(import.meta.dirname, '..');
const errors = [];
const publicApi = JSON.parse(await readFile(join(workspace, 'docs/public-api.json'), 'utf8'));
if (JSON.stringify(await packageSurfaces(workspace)) !== JSON.stringify(publicApi.packages))
  errors.push('Declared package surfaces changed; update the reviewed public API map.');

for (const legacy of [
  'features/session',
  'features/shell',
  'features/project',
  'shared/stores/useUIStore.ts',
]) {
  const relative = `apps/web/src/${legacy}`;
  const path = join(workspace, relative);
  try {
    const info = await stat(path);
    if (info.isFile() || (await readdir(path, { recursive: true })).some(isSourceFile))
      errors.push(`${relative}: legacy architecture entries must remain empty or removed`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
try {
  const baseline = JSON.parse(
    await readFile(join(workspace, 'apps/web/architecture-cycles.json'), 'utf8'),
  );
  if (Object.keys(baseline).length)
    errors.push('The accepted feature graph is acyclic; cycle exceptions cannot be added.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const coverage = await workspaceCoverageErrors(workspace);
errors.push(...coverage.errors);
if (errors.length) {
  console.error(
    'Repository architecture governance violations:\n' +
      errors.map((error) => `- ${error}`).join('\n'),
  );
  process.exitCode = 1;
} else
  console.log(
    `Repository architecture governance is valid; ${coverage.count} repository files are covered.`,
  );
