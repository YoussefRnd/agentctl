import { baseConfig } from '@agentctl/eslint-config';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**', 'out/**', 'eslint.config.mjs'],
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
