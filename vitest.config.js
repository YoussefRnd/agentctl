import { defineConfig } from 'vitest/config';

const commonExclude = ['**/node_modules/**', '**/dist/**'];

export default defineConfig({
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
            'apps/server/**/*.{test,spec}.{ts,js}',
          ],
          exclude: commonExclude,
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'jsdom',
          globals: true,
          include: [
            'packages/ui/**/*.{test,spec}.{ts,js,tsx,jsx}',
            'apps/web/**/*.{test,spec}.{ts,js,tsx,jsx}',
          ],
          exclude: commonExclude,
        },
      },
    ],
  },
});
