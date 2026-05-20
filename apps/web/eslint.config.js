import { baseConfig } from '@agentctl/eslint-config';
import { reactConfig } from '@agentctl/eslint-config/react';
import { vitestConfig } from '@agentctl/eslint-config/vitest';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**'],
  },
  ...baseConfig,
  ...reactConfig,
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


