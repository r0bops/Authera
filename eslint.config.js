import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'packages/db/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // packages/domain is pure logic: no HTTP, UI, LLM, payment, or database imports.
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'hono',
                'hono/*',
                '@hono/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'openai',
                '@openai/*',
                '@yuno-payments/*',
                'pg',
                'pg/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'drizzle-kit',
                '@agentcerta/db',
                '@agentcerta/api',
                '@agentcerta/web',
              ],
              message:
                'packages/domain must stay pure: no HTTP, React, OpenAI, Yuno, or database imports.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
