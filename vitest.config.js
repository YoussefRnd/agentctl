import { defineConfig } from 'vitest/config';
import path from 'node:path';

const commonExclude = ['**/node_modules/**', '**/dist/**', '**/out/**'];
const webAlias = {
  '@': path.resolve(import.meta.dirname, 'apps/web/src'),
};

export default defineConfig({
  resolve: {
    alias: webAlias,
  },
  test: {
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
