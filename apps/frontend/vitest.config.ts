import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { frontendAliases } from './build/aliases';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  resolve: { alias: frontendAliases(), dedupe: ['react', 'react-dom', 'lucide-react', 'zod', 'zustand', 'react-markdown', 'remark-gfm', 'remend', 'shiki'] },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    maxWorkers: 1,
    reporters: ['verbose'],
  },
});
