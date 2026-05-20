import { baseConfig } from '@agentctl/eslint-config';
import { vitestConfig } from '@agentctl/eslint-config/vitest';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**'],
  },
  ...baseConfig,
  ...vitestConfig,
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
