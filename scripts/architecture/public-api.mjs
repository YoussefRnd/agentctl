import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function packageSurfaces(workspace) {
  const result = [];
  for (const name of ['shared', 'api-client', 'core', 'ui']) {
    const root = `packages/${name}`;
    const manifest = JSON.parse(await readFile(resolve(workspace, root, 'package.json'), 'utf8'));
    result.push({
      package: manifest.name,
      root,
      entries: Object.keys(manifest.exports ?? { '.': manifest.main }).sort(),
    });
  }
  const server = JSON.parse(await readFile(resolve(workspace, 'apps/server/package.json'), 'utf8'));
  result.push({
    package: server.name,
    root: 'apps/server',
    entries: Object.keys(server.exports).sort(),
  });
  return result;
}
