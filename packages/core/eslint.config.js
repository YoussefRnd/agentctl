import { baseConfig } from '@agentctl/eslint-config';
import { vitestConfig } from '@agentctl/eslint-config/vitest';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**', 'drizzle/**'],
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
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/db/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
          message:
            'Avoid double casts through unknown (`as unknown as X`). Narrow via type guards or use the SDK type directly.',
        },
        {
          selector: 'TSAsExpression > TSAnyKeyword',
          message: 'Avoid `as any` casts. Use a type guard or the SDK type directly.',
        },
        {
          selector: 'TSTypeAnnotation > TSAnyKeyword',
          message:
            'Avoid `any` type annotations. Use unknown + narrowing or the SDK type directly.',
        },
      ],
    },
  },
];
