import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const packageRoots = {
  '@agentctl/shared': 'packages/shared',
  '@agentctl/api-client': 'packages/api-client',
  '@agentctl/core': 'packages/core',
  '@agentctl/ui': 'packages/ui',
  '@agentctl/server': 'apps/server',
  '@agentctl/web': 'apps/web',
  '@agentctl/desktop': 'apps/desktop',
};
export const testFiles = '\\.(?:test|spec)\\.[cm]?[jt]sx?$';
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const external = (names) => `(?:^|/node_modules/)(?:${names})(?:/|$)`;

export async function dependencyConfig(workspace) {
  const publicApi = JSON.parse(await readFile(resolve(workspace, 'docs/public-api.json'), 'utf8'));
  const forbidden = [];
  const forbid = (name, from, to, comment, extra = {}) =>
    forbidden.push({
      name,
      severity: 'error',
      comment,
      from: { path: from, pathNot: testFiles },
      to: typeof to === 'string' ? { path: to } : to,
      ...extra,
    });

  const allowed = {
    'packages/shared': [],
    'packages/ui': [],
    'packages/core': ['packages/shared'],
    'packages/api-client': ['packages/shared'],
    'apps/server': ['packages/core', 'packages/shared'],
    'apps/web': ['packages/ui', 'packages/api-client', 'packages/shared'],
    'apps/desktop': ['apps/server', 'packages/core', 'packages/shared'],
  };
  const roots = Object.values(packageRoots);
  for (const [owner, dependencies] of Object.entries(allowed)) {
    const denied = roots.filter((root) => root !== owner && !dependencies.includes(root));
    forbid(
      `direction-${owner.replace('/', '-')}`,
      `^${owner}/src/`,
      `^(?:${denied.join('|')})/`,
      `${owner} cannot depend on these application/package implementations`,
    );
  }
  forbid(
    'production-not-tests',
    '^(?:apps|packages)/',
    { path: testFiles },
    'Production code cannot import test fixtures',
  );
  forbid(
    'shared-no-host-runtime',
    '^packages/shared/src/',
    { dependencyTypes: ['core'] },
    'Shared contracts cannot depend on Node runtime adapters',
  );
  forbid(
    'shared-no-react',
    '^packages/shared/src/',
    external('react'),
    'Shared contracts cannot depend on React',
  );
  forbid(
    'ui-no-host-runtime',
    '^packages/ui/src/',
    { dependencyTypes: ['core'] },
    'UI foundations cannot depend on Node runtime adapters',
  );
  forbid(
    'ui-no-product-state',
    '^packages/ui/src/',
    external('@tanstack/react-query|zustand|sonner|react-router(?:-dom)?|axios|ky|undici'),
    'UI foundations cannot own product state, routing or networking',
  );
  forbid(
    'ui-no-app-code',
    '^packages/ui/src/',
    '^apps/',
    'UI sources and tests cannot depend on application code',
    {
      from: { path: '^packages/ui/src/' },
    },
  );
  forbid(
    'client-no-host-runtime',
    '^packages/api-client/src/',
    { dependencyTypes: ['core'] },
    'The browser API client cannot depend on host implementations',
  );
  forbid(
    'client-no-ui-policy',
    '^packages/api-client/src/',
    external('sonner|react-router(?:-dom)?'),
    'Client transport cannot own toast or navigation policy',
  );
  forbid(
    'core-no-transports',
    '^packages/core/src/',
    external('fastify|@fastify/[^/]+|react'),
    'Core cannot depend on app transports or UI',
  );
  forbid(
    'core-no-telemetry-sdk',
    '^packages/core/src/',
    external(
      '@opentelemetry/(?:sdk-[^/]+|exporter-[^/]+|context-[^/]+|resources|core|instrumentation[^/]*)',
    ),
    'Core instrumentation uses the OpenTelemetry API; hosts own SDKs and exporters',
  );

  for (const [name, from, to, comment] of [
    [
      'preload-not-main',
      '^apps/desktop/src/preload/',
      '^apps/desktop/src/main/',
      'Preload must use the shared IPC contract',
    ],
    [
      'main-not-preload',
      '^apps/desktop/src/main/',
      '^apps/desktop/src/preload/',
      'Main must use the shared IPC contract',
    ],
    [
      'agent-not-acp',
      '^packages/core/src/(?:agent|providers)/',
      '^packages/core/src/acp/',
      'Agent and provider contracts cannot depend on ACP adapters',
    ],
    [
      'provider-not-facade',
      '^packages/core/src/providers/registry/',
      '/provider-registry\\.[cm]?[jt]s$',
      'Provider capabilities cannot depend on their facade',
    ],
    [
      'vault-not-database',
      '^packages/core/src/security/credential-vault\\.ts$',
      `${external('drizzle-orm')}|^packages/core/src/db/`,
      'Secret storage cannot own database migration policy',
    ],
    [
      'pairing-not-schema',
      '^packages/core/src/auth/auth-manager\\.ts$',
      `${external('drizzle-orm')}|^packages/core/src/db/schema`,
      'Pairing policy delegates durable session access',
    ],
    [
      'context-no-io',
      '^packages/core/src/context/(?:context-service|workspace-index)\\.ts$',
      `${external('simple-git')}|^(?:node:)?fs(?:/|$)`,
      'Context policy delegates filesystem and Git access',
    ],
    [
      'skills-no-io',
      '^packages/core/src/skills/registry\\.ts$',
      `${external('yaml')}|^(?:node:)?(?:fs|path|os)(?:/|$)`,
      'The skill catalog delegates configuration, parsing and file access',
    ],
    [
      'mcp-no-adapters',
      '^packages/core/src/mcp/(?:mcp-gateway|mcp-connections)\\.ts$',
      `${external('@modelcontextprotocol/sdk')}|^(?:node:)?child_process$`,
      'MCP routing uses the connection adapter contract',
    ],
    [
      'session-not-acp',
      '^packages/core/src/session/',
      '^packages/core/src/acp/',
      'Session workflows depend on agent contracts, not protocol adapters',
    ],
    [
      'session-no-git',
      '^packages/core/src/session/(?:services|execution|projection)/',
      `${external('simple-git')}|^packages/core/src/(?:git/|default-repository-service\\.)`,
      'Session workflows use repository capabilities rather than Git adapters',
    ],
    [
      'session-persistence-direction',
      '^packages/core/src/session/persistence/',
      '^(?:node:)?(?:fs|child_process)(?:/|$)|^packages/core/src/session/(?:runtime|services|commands|projection|execution)/',
      'Persistence cannot depend on provider, filesystem or workflow implementations',
    ],
    [
      'repository-no-adapters',
      '^packages/core/src/(?:workspace|repository)/',
      `${external('simple-git')}|^(?:node:)?child_process$|^packages/core/src/(?:git|acp|providers|session)/`,
      'Repository and workspace workflows cannot depend on concrete VCS, forge or agent implementations',
    ],
    [
      'forge-direction',
      '^packages/core/src/forge/',
      `${external('simple-git')}|^packages/core/src/(?:git|db|session)/`,
      'Forge adapters cannot own Git mutation, persistence or session lifecycle',
    ],
    [
      'git-capability-direction',
      '^packages/core/src/git/capabilities/',
      '^packages/core/src/git/(?:worktree-manager|composition|index)\\.[cm]?[jt]s$|^packages/core/src/forge/(?!types\\.[cm]?[jt]s$)',
      'Git capabilities cannot depend on the facade, composition or concrete forge adapters',
    ],
    [
      'immutable-snapshot-no-mutation',
      '^packages/core/src/git/snapshot-comparison\\.ts$',
      '^(?:node:)?fs(?:/|$)|/(?:mutex|snapshot-service)\\.[cm]?[jt]s$',
      'Immutable snapshot comparisons cannot own mutation or capture locks',
    ],
    [
      'server-transport-direction',
      '^apps/server/src/(?:plugins/ts-rest|routes)/',
      `${external('drizzle-orm|simple-git')}|^packages/core/src/(?:db|acp)/|^(?:node:)?(?:fs|path|os)(?:/|$)`,
      'Server transports must delegate persistence, filesystem and provider workflows',
    ],
    [
      'server-service-direction',
      '^apps/server/src/services/',
      '^apps/server/src/(?:routes|plugins)/',
      'Application services cannot depend on transport handlers',
    ],
  ])
    forbid(name, from, to, comment);
  forbid(
    'session-internals-not-composition',
    '^packages/core/src/session/',
    '^packages/core/src/session/(?:composition/|(?:manager|index)\\.[cm]?[jt]s$)',
    'Session internals cannot depend on the facade or composition',
    {
      from: {
        path: '^packages/core/src/session/',
        pathNot: [testFiles, '/composition/', '/(?:manager|index)\\.[cm]?[jt]s$'],
      },
    },
  );
  forbid(
    'contracts-no-cycles',
    '^packages/(?:shared|api-client)/src/',
    { path: '^packages/(?:shared|api-client)/src/', circular: true },
    'Contracts and client modules must remain acyclic',
  );
  forbid(
    'no-unresolved-internal-imports',
    '^(?:apps|packages)/',
    { couldNotResolve: true, path: '^(?:@agentctl/|@/|\\.|(?:apps|packages)/)' },
    'Internal imports must resolve, including declared package public entries',
  );

  for (const surface of publicApi.packages) {
    forbid(
      `public-entry-${surface.package.slice(10)}`,
      '^(?:apps|packages)/',
      {
        path: `^${surface.root}/src/`,
        dependencyTypes: ['local'],
        dependencyTypesNot: ['aliased'],
      },
      'Relative imports cannot bypass package public entries',
      {
        from: { path: '^(?:apps|packages)/', pathNot: [testFiles, `^${surface.root}/`] },
      },
    );
  }

  forbid(
    'web-shared-direction',
    '^apps/web/src/shared/',
    '^apps/web/src/(?:app|routes|features)/',
    'Shared capabilities cannot depend on application or feature code',
    {
      from: { path: '^apps/web/src/shared/' },
    },
  );
  forbid(
    'web-features-not-composition',
    '^apps/web/src/features/',
    '^apps/web/src/(?:app|routes)/',
    'Feature code cannot depend on app or route composition',
    {
      from: { path: '^apps/web/src/features/' },
    },
  );
  for (const [feature, denied] of [
    ['sessions', 'composer|review'],
    ['composer', 'review'],
    ['review', 'composer'],
  ])
    forbid(
      `web-${feature}-direction`,
      `^apps/web/src/features/${feature}/`,
      `^apps/web/src/features/(?:${denied})/`,
      'Session, composer and review composition follows its accepted direction',
    );
  for (const { feature, entries } of publicApi.features ?? []) {
    const root = `apps/web/src/features/${escape(feature)}/`;
    forbid(
      `feature-public-entry-${feature}`,
      '^apps/web/src/',
      { path: `^${root}`, pathNot: `^${root}(?:${entries.map(escape).join('|')})\\.[cm]?[jt]sx?$` },
      'Cross-feature imports must use a reviewed public entry',
      {
        from: { path: '^apps/web/src/', pathNot: `^${root}` },
      },
    );
  }
  forbid(
    'features-no-folder-cycles',
    '^apps/web/src/features/[^/]+$',
    { circular: true },
    'Feature dependencies must remain acyclic even when individual modules are acyclic',
    {
      scope: 'folder',
      from: { path: '^apps/web/src/features/[^/]+$' },
    },
  );

  // Resolve only declared public entries to source; no existing dist/ tree is needed.
  const alias = { '@': resolve(workspace, 'apps/web/src') };
  for (const [name, root] of Object.entries(packageRoots)) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(resolve(workspace, root, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const exports = manifest.exports ?? { '.': manifest.main ?? './src/index.ts' };
    for (const [entry, target] of Object.entries(exports)) {
      const value = typeof target === 'string' ? target : target.default;
      if (!value) throw new Error(`No runtime export for ${name}${entry}`);
      const source = value.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
      alias[`${name}${entry === '.' ? '' : entry.slice(1)}$`] = resolve(workspace, root, source);
    }
  }
  return {
    rules: { forbidden },
    options: {
      baseDir: workspace,
      tsPreCompilationDeps: true,
      parser: 'tsc',
      doNotFollow: { path: 'node_modules|\\.(?:css|json)$' },
    },
    resolveOptions: {
      alias,
      extensions: [
        '.ts',
        '.tsx',
        '.mts',
        '.cts',
        '.d.ts',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.json',
        '.css',
      ],
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
        '.cjs': ['.cts', '.cjs'],
      },
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
  };
}
