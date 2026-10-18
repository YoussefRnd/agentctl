import 'vite-plus/test/config';
import { defineConfig } from 'vite-plus';
import path from 'node:path';

const commonExclude = ['**/node_modules/**', '**/dist/**', '**/out/**'];
const webAlias = {
  '@': path.resolve(import.meta.dirname, 'apps/web/src'),
};

export default defineConfig({
  lint: {
    rules: {
      'react/incompatible-library': 'off',
      'vite-plus/prefer-vite-plus-imports': 'error',
      'agentctl/no-owned-networking': 'error',
      'agentctl/no-transport-database': 'error',
      'agentctl/explicit-runtime-initialization': 'error',
    },
    // Project-reference typechecking stays in pnpm typecheck; preserve the existing lint policy.
    options: { typeAware: false, typeCheck: false },
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      { name: 'agentctl', specifier: './scripts/oxlint/architecture.mjs' },
    ],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'all',
    printWidth: 100,
    arrowParens: 'always',
    endOfLine: 'lf',
    sortPackageJson: false,
    sortTailwindcss: {},
    ignorePatterns: [
      'node_modules/',
      '.pnpm-store/',
      'pnpm-lock.yaml',
      'dist/',
      'out/',
      'release/',
      'build/',
      '*.tsbuildinfo',
      'drizzle/',
      '*.sqlite',
      '*.sqlite-journal',
      '*.db',
      '.env',
      '.env.*',
      '*.log',
      '.git/',
    ],
  },
  staged: {
    '*.{ts,tsx,js,jsx,mjs,cjs}': ['vp lint --fix', 'vp fmt'],
    '*.{json,jsonc,json5,md,css,yaml,yml,html}': 'vp fmt',
  },
  resolve: {
    alias: webAlias,
  },
  test: {
    maxWorkers: 2,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: [
            'packages/core/**/*.{test,spec}.{ts,js}',
            'packages/shared/**/*.{test,spec}.{ts,js}',
            'packages/api-client/**/*.{test,spec}.{ts,js}',
            'apps/server/**/*.{test,spec}.{ts,js}',
          ],
          exclude: commonExclude,
        },
      },
      {
        resolve: {
          alias: webAlias,
        },
        test: {
          name: 'browser',
          environment: 'jsdom',
          globals: true,
          setupFiles: [path.resolve(import.meta.dirname, 'apps/web/src/test-setup.ts')],
          include: [
            'packages/ui/**/*.{test,spec}.{ts,js,tsx,jsx}',
            'apps/web/**/*.{test,spec}.{ts,js,tsx,jsx}',
            'apps/desktop/**/*.{test,spec}.{ts,js,tsx,jsx}',
          ],
          exclude: commonExclude,
        },
      },
    ],
  },
});
