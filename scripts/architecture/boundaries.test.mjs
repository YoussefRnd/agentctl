import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, dependencies } from './fixtures.mjs';

test('dependency-cruiser resolves source aliases and rejects static, type, lazy, require and relative bypasses', async () => {
  await fixture(async ({ root, write }) => {
    const forms = [
      "import type { value } from '../../../apps/web/src/index.js';",
      "export * from '../../../apps/web/src/index.js';",
      "const load = () => import('../../../apps/web/src/index.js');",
      "const load = () => require('../../../apps/web/src/index.js');",
      'const load = () => import(`../../../apps/web/src/index.js`);',
      "type Value = import('../../../apps/web/src/index.js').value;",
      "import '@agentctl/web';",
    ];
    for (const [index, statement] of forms.entries())
      await write(`packages/core/src/invalid-${index}.ts`, statement);
    await write('apps/web/src/valid.ts', "import { value } from '@agentctl/shared';");
    await write(
      'packages/ui/src/invalid.ts',
      "import 'node:fs'; import 'zustand'; import '@agentctl/shared';",
    );
    await write('packages/ui/src/product.test.ts', "import '@agentctl/web';");
    await write('apps/desktop/src/preload/index.ts', "export * from '../main/index.js';");
    await write('apps/desktop/src/main/index.ts', "export * from '../preload/index.js';");
    await write('packages/core/src/fixture.test.ts', 'export const fixture = true;');
    await write('packages/core/src/production.ts', "export * from './fixture.test.js';");
    const graph = await dependencies(root);
    assert.equal(graph.exitCode, 1);
    for (const index of forms.keys())
      assert.ok(
        graph.summary.violations.some(
          (item) =>
            item.from.endsWith(`invalid-${index}.ts`) &&
            item.rule.name === 'direction-packages-core',
        ),
        `import form ${index}`,
      );
    const valid = graph.modules.find((item) => item.source === 'apps/web/src/valid.ts');
    assert.equal(valid.dependencies[0].resolved, 'packages/shared/src/index.ts');
    for (const rule of [
      'ui-no-host-runtime',
      'ui-no-product-state',
      'direction-packages-ui',
      'ui-no-app-code',
      'preload-not-main',
      'main-not-preload',
      'production-not-tests',
    ])
      assert.ok(
        graph.summary.violations.some((item) => item.rule.name === rule),
        rule,
      );
  });
});

test('dependency-cruiser enforces internal workflow, adapter and transport directions', async () => {
  await fixture(async ({ root, write }) => {
    const cases = [
      ['agent-not-acp', 'packages/core/src/agent/invalid.ts', 'packages/core/src/acp/driver.ts'],
      [
        'provider-not-facade',
        'packages/core/src/providers/registry/invalid.ts',
        'packages/core/src/providers/provider-registry.ts',
      ],
      [
        'vault-not-database',
        'packages/core/src/security/credential-vault.ts',
        'packages/core/src/db/schema.ts',
      ],
      [
        'pairing-not-schema',
        'packages/core/src/auth/auth-manager.ts',
        'packages/core/src/db/schema.ts',
      ],
      ['context-no-io', 'packages/core/src/context/context-service.ts', 'node:fs'],
      ['skills-no-io', 'packages/core/src/skills/registry.ts', 'node:path'],
      ['mcp-no-adapters', 'packages/core/src/mcp/mcp-gateway.ts', 'node:child_process'],
      [
        'session-not-acp',
        'packages/core/src/session/workflow.ts',
        'packages/core/src/acp/driver.ts',
      ],
      [
        'session-no-git',
        'packages/core/src/session/execution/invalid.ts',
        'packages/core/src/git/adapter.ts',
      ],
      [
        'session-internals-not-composition',
        'packages/core/src/session/runtime/invalid.ts',
        'packages/core/src/session/index.ts',
      ],
      [
        'session-persistence-direction',
        'packages/core/src/session/persistence/invalid.ts',
        'packages/core/src/session/execution/invalid.ts',
      ],
      [
        'repository-no-adapters',
        'packages/core/src/workspace/invalid.ts',
        'packages/core/src/git/adapter.ts',
      ],
      ['forge-direction', 'packages/core/src/forge/invalid.ts', 'packages/core/src/db/schema.ts'],
      [
        'git-capability-direction',
        'packages/core/src/git/capabilities/invalid.ts',
        'packages/core/src/git/composition.ts',
      ],
      ['immutable-snapshot-no-mutation', 'packages/core/src/git/snapshot-comparison.ts', 'node:fs'],
      ['server-transport-direction', 'apps/server/src/routes/invalid.ts', 'node:fs'],
      [
        'server-service-direction',
        'apps/server/src/services/invalid.ts',
        'apps/server/src/plugins/transport.ts',
      ],
      ['shared-no-host-runtime', 'packages/shared/src/invalid.ts', 'node:fs'],
      ['client-no-host-runtime', 'packages/api-client/src/invalid.ts', 'node:fs'],
      ['client-no-ui-policy', 'packages/api-client/src/toast.ts', 'sonner'],
      ['core-no-transports', 'packages/core/src/transport.ts', 'fastify'],
      ['core-no-telemetry-sdk', 'packages/core/src/telemetry-sdk.ts', '@opentelemetry/sdk-trace'],
      ['shared-no-react', 'packages/shared/src/ui.ts', 'react'],
    ];
    const { posix } = await import('node:path');
    const targets = new Set(
      cases
        .filter(([, , target]) => target.startsWith('packages/') || target.startsWith('apps/'))
        .map(([, , target]) => target),
    );
    for (const target of targets) await write(target, 'export const value = 1;');
    for (const [, from, target] of cases) {
      const specifier = targets.has(target)
        ? './' + posix.relative(posix.dirname(from), target).replace(/\.ts$/, '.js')
        : target;
      await write(from, `export * from '${specifier}';`);
    }
    const graph = await dependencies(root);
    for (const [rule, from] of cases)
      assert.ok(
        graph.summary.violations.some((item) => item.from === from && item.rule.name === rule),
        rule,
      );
  });
});
