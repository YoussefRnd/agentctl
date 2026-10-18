import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cruise } from 'dependency-cruiser';
import { dependencyConfig, packageRoots, testFiles } from './architecture/dependency-config.mjs';

const rootIndex = process.argv.indexOf('--root');
const workspace =
  rootIndex >= 0 ? resolve(process.argv[rootIndex + 1]) : resolve(import.meta.dirname, '..');
const config = await dependencyConfig(workspace);
const roots = [];
for (const root of Object.values(packageRoots)) {
  try {
    await access(resolve(workspace, root, 'src'));
    roots.push(`${root}/src`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
// Dependency-cruiser's resolver and reporters use cwd for relative source paths.
process.chdir(workspace);
const run = async (options, forbidden) => {
  const result = await cruise(
    roots,
    {
      ...config.options,
      ...options,
      ruleSet: { forbidden },
      validate: true,
      outputType: 'json',
    },
    config.resolveOptions,
  );
  return typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
};
const graph = await run(
  {},
  config.rules.forbidden.filter((rule) => rule.scope !== 'folder'),
);
// Feature-level cycles concern production dependencies. Test imports still participate
// in public-entry checks above, and production-to-test imports are rejected there.
const production = await run(
  { exclude: { path: testFiles } },
  config.rules.forbidden.filter((rule) => rule.scope === 'folder'),
);
graph.folders = production.folders;
graph.summary.violations.push(...production.summary.violations);
graph.summary.error += production.summary.error;
if (process.argv.includes('--json')) console.log(JSON.stringify(graph, null, 2));
else {
  for (const violation of graph.summary.violations)
    console.error(`${violation.rule.name}: ${violation.from} -> ${violation.to}`);
  if (!graph.summary.error)
    console.log(`Dependency architecture is valid (${graph.modules.length} modules).`);
}
if (graph.summary.error) process.exitCode = 1;
