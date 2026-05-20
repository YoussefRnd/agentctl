import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.js',
    test: {
      name: 'node',
      environment: 'node',
      include: [
        'packages/core/**/*.{test,spec}.{ts,js}',
        'packages/shared/**/*.{test,spec}.{ts,js}',
        'apps/server/**/*.{test,spec}.{ts,js}',
      ],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
  {
    extends: './vitest.config.js',
    test: {
      name: 'browser',
      environment: 'jsdom',
      include: [
        'packages/ui/**/*.{test,spec}.{ts,js,tsx,jsx}',
        'apps/web/**/*.{test,spec}.{ts,js,tsx,jsx}',
      ],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
]);
