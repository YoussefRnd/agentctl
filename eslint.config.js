import { baseConfig } from '@agentctl/eslint-config';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.turbo/**',
      '**/*.db*',
      '**/drizzle/**',
      '**/drizzle.config.ts',
    ],
  },
  ...baseConfig,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
