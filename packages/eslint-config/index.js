import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export const baseConfig = [
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: [
      '*.js',
      '*.mjs',
      '*.cjs',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '**/*.d.ts',
      '**/*.mts',
      '**/*.cts',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.test.js',
      '**/*.test.mjs',
      '**/*.test.cjs',
    ],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  prettier,
];
