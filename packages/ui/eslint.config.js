import { baseConfig } from '@agentctl/eslint-config';
import { reactConfig } from '@agentctl/eslint-config/react';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**'],
  },
  ...baseConfig,
  ...reactConfig,
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


