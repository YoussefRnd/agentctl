import vitestPlugin from 'eslint-plugin-vitest';

export const vitestConfig = [
  {
    plugins: {
      vitest: vitestPlugin,
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/expect-expect': 'off',
    },
  },

];
