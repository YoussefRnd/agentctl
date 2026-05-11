import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

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
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'no-console': 'warn',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/consistent-type-imports': 'error'
		},
	},
	{
		files: ['**/*.js'],
		...tseslint.configs.disableTypeChecked,
	},
	prettier,
];
