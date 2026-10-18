const isTest = (file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const filename = (context) => context.filename.replaceAll('\\', '/');
const inSource = (file, path) => file.includes(`/${path}/`) || file.startsWith(`${path}/`);
const calledName = (node) => {
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return undefined;
  return node.computed ? node.property.value : node.property.name;
};
const runtimeOwners = new Set([
  'DatabaseSync',
  'createDatabase',
  'getDefaultDatabase',
  'loadWorkspaceEnv',
  'CredentialVault',
  'AgentDiagnosticsRecorder',
  'ProviderRegistry',
  'PersistentAgentConnectionManager',
  'McpGateway',
]);

const rules = {
  'no-owned-networking': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        ui: 'UI cannot own networking; delegate to the application client.',
        shared: 'HTTP transport belongs in api-client.',
      },
    },
    create(context) {
      const file = filename(context);
      if (isTest(file)) return {};
      const ui = inSource(file, 'packages/ui/src');
      const shared = inSource(file, 'packages/shared/src');
      if (!ui && !shared) return {};
      const check = (node) => {
        const name = calledName(node.callee);
        if (name === 'fetch' || (ui && ['XMLHttpRequest', 'WebSocket'].includes(name)))
          context.report({ node, messageId: ui ? 'ui' : 'shared' });
      };
      return { CallExpression: check, NewExpression: check };
    },
  },
  'no-transport-database': {
    meta: {
      type: 'problem',
      schema: [],
      messages: { database: 'Database access belongs in application queries/services.' },
    },
    create(context) {
      const file = filename(context);
      if (isTest(file) || !/(?:^|\/)apps\/server\/src\/(?:routes|plugins\/ts-rest)\//.test(file))
        return {};
      return {
        MemberExpression(node) {
          if (
            node.object.type === 'Identifier' &&
            node.object.name === 'fastify' &&
            (node.computed ? node.property.value : node.property.name) === 'db'
          )
            context.report({ node, messageId: 'database' });
        },
      };
    },
  },
  'explicit-runtime-initialization': {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        eager: 'Runtime initialization must be called explicitly at startup ({{name}}).',
      },
    },
    create(context) {
      const file = filename(context);
      if (
        isTest(file) ||
        !/(?:^|\/)packages\/core\/src\/(?:db\/|default-)/.test(file) ||
        file.endsWith('/db/database.ts')
      )
        return {};
      const check = (node) => {
        if (node.callee.type !== 'Identifier' || !runtimeOwners.has(node.callee.name)) return;
        const ancestors = context.sourceCode.getAncestors(node);
        const deferred = ancestors.some((ancestor, index) => {
          // Instance field values run on construction; static fields and computed
          // keys run when the class is defined.
          if (
            ancestor.type === 'PropertyDefinition' &&
            !ancestor.static &&
            (ancestor.value === node || ancestor.value === ancestors[index + 1])
          )
            return true;
          if (
            !['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
              ancestor.type,
            )
          )
            return false;
          // An immediately invoked function executes while the module loads.
          const parent = ancestor.parent;
          return !(parent?.type === 'CallExpression' && parent.callee === ancestor);
        });
        if (!deferred)
          context.report({ node, messageId: 'eager', data: { name: node.callee.name } });
      };
      return { CallExpression: check, NewExpression: check };
    },
  },
};

export default { meta: { name: 'agentctl-architecture' }, rules };
