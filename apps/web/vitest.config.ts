import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // The native controls/Markdown integration suites also run on developer laptops.
    // Bound concurrent DOM workloads instead of competing for every CPU core.
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      exclude: ['app/**', '**/*.config.ts', '**/*.d.ts', 'tests/**'],
      include: ['features/**/*.ts', 'features/**/*.tsx', 'gateways/**/*.ts', 'store/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70
      }
    }
  }
});
