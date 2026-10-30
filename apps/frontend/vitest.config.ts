import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { frontendAliases } from './build/aliases';
import { adaptLegacyClientSource } from './build/adapt-legacy-client';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  resolve: { alias: frontendAliases() },
  plugins: [{ name: 'legacy-client-bridge', enforce: 'pre', transform: adaptLegacyClientSource }],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    maxWorkers: 1,
    reporters: ['verbose'],
  },
});
