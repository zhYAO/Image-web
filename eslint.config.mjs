import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { settings: { react: { version: '19.2' } } },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/domain/**/*.ts'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/frontend/**/*.{js,mjs,ts,tsx}'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  globalIgnores([
    '**/.next/**',
    '**/.next-*/**',
    '**/coverage/**',
    'apps/frontend/dist/**',
    'apps/frontend/.prerender/**',
    '**/node_modules/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'doc/**',
  ]),
]);
