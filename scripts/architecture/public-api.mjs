import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

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
  return result;
}

/** Public import policy applies to application consumers as well as other packages. */
export function publicImportErrors(file, imports, surfaces) {
  const errors = [];
  for (const specifier of imports) {
    const surface = surfaces.find(
      (item) => specifier === item.package || specifier.startsWith(item.package + '/'),
    );
    if (surface) {
      const entry =
        specifier === surface.package ? '.' : '.' + specifier.slice(surface.package.length);
      if (!surface.entries.includes(entry))
        errors.push(`${file}: undeclared package entry ${specifier}`);
    }
    if (specifier.startsWith('.')) {
      const target = resolve('/', dirname(file), specifier).slice(1).split(sep).join('/');
      for (const owner of surfaces)
        if (target.startsWith(owner.root + '/src/') && !file.startsWith(owner.root + '/'))
          errors.push(
            `${file}: relative import bypasses ${owner.package} public entries (${specifier})`,
          );
    }
  }
  return errors;
}
