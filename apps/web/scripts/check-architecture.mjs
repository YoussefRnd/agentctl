import { ownershipErrors } from '../../../scripts/architecture/ownership.mjs';
import {
  importSpecifiers,
  cycleEdges,
  cycleBaselineErrors,
} from '../../../scripts/architecture/dependencies.mjs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';

const webRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(webRoot, 'src');
const workspaceRoot = resolve(webRoot, '../..');
const uiRoot = join(workspaceRoot, 'packages/ui/src');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const legacyRoots = [
  'features/session',
  'features/shell',
  'features/project',
  'shared/stores/useUIStore.ts',
];
const errors = [];
const featureGraph = new Map();
const publicApi = JSON.parse(await readFile(join(workspaceRoot, 'docs/public-api.json'), 'utf8'));
const publicFeatures = new Map(publicApi.features.map((item) => [item.feature, item.entries]));
const cycleBaseline = JSON.parse(await readFile(join(webRoot, 'architecture-cycles.json'), 'utf8'));

if (Object.keys(cycleBaseline).length)
  errors.push('The accepted feature graph is acyclic; cycle exceptions cannot be added.');

async function walk(directory, includeAssets = false) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, includeAssets)));
    else if (includeAssets || sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function featureName(path) {
  const parts = relative(sourceRoot, path).split(sep);
  return parts[0] === 'features' ? parts[1] : undefined;
}

function featureFromSpecifier(specifier) {
  const match = specifier.match(/^@\/features\/([^/]+)(?:\/(.+))?$/);
  return match ? { name: match[1], internalPath: match[2] } : undefined;
}

function report(path, message) {
  errors.push(`${relative(workspaceRoot, path)}: ${message}`);
}

for (const legacyRoot of legacyRoots) {
  const path = join(sourceRoot, legacyRoot);
  try {
    const info = await stat(path);
    if (info.isFile()) report(path, 'legacy architecture entry must be removed');
    if (info.isDirectory() && (await walk(path, includeAssets)).length > 0) {
      report(path, 'legacy feature directory must remain empty or be removed');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const sourceFiles = await walk(sourceRoot, true);
const ledger = JSON.parse(await readFile(join(workspaceRoot, 'docs/web-ownership.json'), 'utf8'));
errors.push(
  ...ownershipErrors(
    sourceFiles
      .filter((path) => !/\.(test|spec)\.[jt]sx?$/.test(path))
      .map((path) => relative(workspaceRoot, path)),
    ledger.areas,
  ),
);
for (const area of ledger.areas) await readFile(join(workspaceRoot, area.evidence), 'utf8');
for (const path of sourceFiles.filter((path) => sourceExtensions.has(extname(path)))) {
  const source = await readFile(path, 'utf8');
  const ownerFeature = featureName(path);
  const imports = importSpecifiers(source, path);
  const production = !/\.(test|spec)\.[jt]sx?$/.test(path);
  function recordDependency(target) {
    if (!production || !ownerFeature || !target || target === ownerFeature) return;
    if (!featureGraph.has(ownerFeature)) featureGraph.set(ownerFeature, new Set());
    featureGraph.get(ownerFeature).add(target);
  }

  for (const specifier of imports) {
    const resolvedTarget = specifier.startsWith('@/')
      ? resolve(sourceRoot, specifier.slice(2))
      : specifier.startsWith('.')
        ? resolve(dirname(path), specifier)
        : undefined;
    const targetArea = resolvedTarget
      ? relative(sourceRoot, resolvedTarget).split(sep)[0]
      : undefined;
    const targetFeature = resolvedTarget ? featureName(resolvedTarget) : undefined;
    if (
      relative(sourceRoot, path).split(sep)[0] === 'shared' &&
      ['app', 'routes', 'features'].includes(targetArea)
    ) {
      report(
        path,
        'shared capabilities cannot depend on application or feature code, including relative barrels',
      );
    }
    if (
      production &&
      ((ownerFeature === 'sessions' && ['composer', 'review'].includes(targetFeature)) ||
        (ownerFeature === 'composer' && targetFeature === 'review') ||
        (ownerFeature === 'review' && targetFeature === 'composer'))
    ) {
      report(
        path,
        'session, composer and review composition must follow their accepted dependency direction',
      );
    }
    const aliasFeature = featureFromSpecifier(specifier);
    recordDependency(aliasFeature?.name);
    if (
      aliasFeature &&
      aliasFeature.name !== ownerFeature &&
      aliasFeature.internalPath &&
      !(publicFeatures.get(aliasFeature.name) ?? []).includes(
        aliasFeature.internalPath.replace(/\.[jt]sx?$/, ''),
      )
    ) {
      report(path, `cross-feature import must use @/features/${aliasFeature.name}`);
    }

    if (specifier.startsWith('.')) {
      const target = normalize(resolve(dirname(path), specifier));
      const targetFeature = featureName(target);
      recordDependency(targetFeature);
      const targetArea = relative(sourceRoot, target).split(sep)[0];
      if (ownerFeature && (targetArea === 'app' || targetArea === 'routes')) {
        report(path, `feature code cannot depend on ${targetArea}`);
      }
      if (targetFeature && targetFeature !== ownerFeature) {
        const entries = (publicFeatures.get(targetFeature) ?? []).map((entry) =>
          join(sourceRoot, 'features', targetFeature, entry),
        );
        if (
          ![
            ...entries,
            ...entries.flatMap((entry) => [entry + '.js', entry + '.ts', entry + '.tsx']),
          ].includes(target)
        ) {
          report(path, `relative import crosses into feature "${targetFeature}" internals`);
        }
      }
    }

    if (ownerFeature && (specifier.startsWith('@/app/') || specifier.startsWith('@/routes/'))) {
      report(path, 'feature code cannot depend on app or route composition');
    }
  }

  if (path.includes(`${sep}shared${sep}`) && /@\/(?:app|features|routes)\//.test(source)) {
    report(path, 'shared code cannot depend on app, routes, or features');
  }
}

for (const path of await walk(uiRoot)) {
  const source = await readFile(path, 'utf8');
  if (/apps\/|@\/|@agentctl\/(?:web|desktop)/.test(source)) {
    report(path, 'packages/ui cannot depend on application code');
  }
}

errors.push(...cycleBaselineErrors(cycleEdges(featureGraph), cycleBaseline));

if (errors.length > 0) {
  console.error('Architecture boundary violations:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  if (process.argv.includes('--json'))
    console.log(
      JSON.stringify(
        {
          features: Object.fromEntries(
            [...featureGraph].sort().map(([key, values]) => [key, [...values].sort()]),
          ),
          cycles: cycleEdges(featureGraph),
          baseline: cycleBaseline,
        },
        null,
        2,
      ),
    );
  else console.log('Architecture boundaries are valid.');
}
