import { posix } from 'node:path';

const roots = {
  '@agentctl/shared': 'packages/shared',
  '@agentctl/api-client': 'packages/api-client',
  '@agentctl/core': 'packages/core',
  '@agentctl/ui': 'packages/ui',
  '@agentctl/server': 'apps/server',
  '@agentctl/web': 'apps/web',
  '@agentctl/desktop': 'apps/desktop',
};
export function dependencyTarget(file, specifier) {
  file = file.replaceAll('\\', '/');
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(file), specifier));
  if (specifier.startsWith('@/') && file.startsWith('apps/web/'))
    return 'apps/web/src/' + specifier.slice(2);
  for (const [name, root] of Object.entries(roots)) {
    if (specifier === name) return root + '/src/index.ts';
    if (specifier.startsWith(name + '/')) return root + '/src/' + specifier.slice(name.length + 1);
  }
}

/** Canonical paths make package, relative and alias spellings obey the same direction. */
export function boundaryErrors(file, imports) {
  const owner = Object.values(roots).find((root) => file.startsWith(root + '/'));
  const allowed = {
    'packages/shared': [],
    'packages/ui': [],
    'packages/core': ['packages/shared'],
    'packages/api-client': ['packages/shared'],
    'apps/server': ['packages/core', 'packages/shared'],
    'apps/web': ['packages/ui', 'packages/api-client', 'packages/shared'],
    'apps/desktop': ['apps/server', 'packages/core', 'packages/shared'],
  };
  const errors = [];
  for (const specifier of imports) {
    const target = dependencyTarget(file, specifier);
    const targetOwner =
      target && Object.values(roots).find((root) => target.startsWith(root + '/'));
    if (owner && targetOwner && owner !== targetOwner && !allowed[owner].includes(targetOwner))
      errors.push(`${file}: ${owner} cannot depend on ${targetOwner} (${specifier})`);
    if (
      target &&
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(target) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
    )
      errors.push(`${file}: production code cannot import test fixtures (${specifier})`);
    if (
      file.startsWith('packages/ui/') &&
      /^(?:node:|@tanstack\/react-query|zustand|sonner|react-router|@agentctl\/)/.test(specifier)
    )
      errors.push(
        `${file}: UI foundations cannot own runtime, product or networking state (${specifier})`,
      );
    if (
      file.startsWith('apps/desktop/src/preload/') &&
      target?.startsWith('apps/desktop/src/main/')
    )
      errors.push(`${file}: preload must use the shared IPC contract (${specifier})`);
    if (
      file.startsWith('apps/desktop/src/main/') &&
      target?.startsWith('apps/desktop/src/preload/')
    )
      errors.push(`${file}: main process must use the shared IPC contract (${specifier})`);
    if (file.startsWith('packages/ui/') && /^(?:axios|ky|undici)(?:\/|$)/.test(specifier))
      errors.push(`${file}: networking belongs to the application client (${specifier})`);
  }
  return errors;
}
