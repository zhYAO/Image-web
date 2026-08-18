import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    'packages/supabase/src/database.types.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
  ...tseslint.configs.recommended,
  ...nextVitals,
  ...nextTypeScript,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
    settings: {
      react: {
        version: '19.2.8',
      },
    },
  },
]);
