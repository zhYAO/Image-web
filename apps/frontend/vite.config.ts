import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { frontendAliases } from './build/aliases';
import { assertClientSource, isAllowedClientModule } from './build/client-boundary';
import { adaptLegacyClientSource } from './build/adapt-legacy-client';
import { namespacePublicAssetSource } from './build/public-asset-source';
import { validateCandidateDescriptor, validateCandidateMetadata } from './scripts/candidate-metadata.mjs';
import { readBuildSource, assertBuildSourceUnchanged, readSourceSnapshot } from './scripts/build-source-identity.mjs';

export default defineConfig(({ command, isSsrBuild }) => {
  // Explicit, non-secret build inputs only. Never map process.env or VITE_*.
  const namespace = process.env.ZIMAGE_ASSET_NAMESPACE ?? '';
  if (command === 'build' && (namespace === 'none' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(namespace))) throw new Error('An explicit frontend asset namespace is required');
  let descriptor: unknown;
  try { descriptor = process.env.ZIMAGE_FRONTEND_COMPATIBILITY ? JSON.parse(process.env.ZIMAGE_FRONTEND_COMPATIBILITY) : undefined; }
  catch { throw new Error('Invalid frontend compatibility descriptor'); }
  const candidateDescriptor = command === 'build' ? validateCandidateDescriptor(descriptor) : undefined;
  let sourceSnapshot: ReturnType<typeof readBuildSource> | undefined;
  const dsn = process.env.ZIMAGE_SENTRY_DSN;
  const sample = Number(process.env.ZIMAGE_SENTRY_TRACES_SAMPLE_RATE ?? '0');
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new Error('Invalid browser trace sample rate');
  if (dsn) {
    try { const url = new URL(dsn); if (url.protocol !== 'https:' || url.password || url.search || url.hash) throw new Error(); }
    catch { throw new Error('Invalid public browser telemetry DSN'); }
  }
  return {
    root: fileURLToPath(new URL('./', import.meta.url)),
    envDir: false,
    envPrefix: [],
    publicDir: false,
    base: namespace ? `/frontend-assets/${namespace}/` : '/',
    esbuild: { jsx: 'automatic' },
    define: {
      __ZIMAGE_ASSET_NAMESPACE__: JSON.stringify(namespace),
      __ZIMAGE_COMPATIBILITY__: JSON.stringify(descriptor ?? null),
      __ZIMAGE_OBSERVABILITY__: JSON.stringify(dsn ? { dsn, release: namespace, environment: 'production', tracesSampleRate: sample } : null),
    },
    resolve: { alias: frontendAliases(), dedupe: ['react', 'react-dom', 'lucide-react', 'zod', 'zustand', 'react-markdown', 'remark-gfm', 'remend', 'shiki'] },
    build: {
      outDir: isSsrBuild ? '.prerender' : 'dist',
      emptyOutDir: true,
      sourcemap: false,
      emitAssets: true,
      manifest: !isSsrBuild,
      rollupOptions: isSsrBuild ? { output: { entryFileNames: 'entry.js' } } : undefined,
    },
    plugins: [{
      name: 'zimage-client-boundary',
      enforce: 'pre',
      transform(code, id) {
        // react-dom/server is build-only and Vite normally externalizes it.
        if (isSsrBuild && /[\\/]react-dom[\\/](?:server|cjs[\\/]react-dom-server)/.test(id)) return;
        const adapted = namespacePublicAssetSource(adaptLegacyClientSource(code, id), id, namespace);
        assertClientSource(adapted, id);
        return adapted;
      },
      buildStart() {
        sourceSnapshot = readBuildSource(fileURLToPath(new URL('../../', import.meta.url)));
        if (isSsrBuild) assertBuildSourceUnchanged(readSourceSnapshot(fileURLToPath(new URL('./dist/.vite/source-snapshot.json', import.meta.url))), sourceSnapshot);
      },
      generateBundle() {
        if (!sourceSnapshot) this.error('Missing frontend build source snapshot');
        const finalSource = readBuildSource(fileURLToPath(new URL('../../', import.meta.url)));
        assertBuildSourceUnchanged(sourceSnapshot, finalSource);
        const candidate = validateCandidateMetadata({ schemaVersion: 1, namespace, ...candidateDescriptor,
          sourceIdentity: sourceSnapshot.sourceIdentity, buildToolchainFingerprint: sourceSnapshot.buildToolchainFingerprint }, namespace);
        this.emitFile({ type: 'asset', fileName: isSsrBuild ? 'source-snapshot.json' : '.vite/source-snapshot.json', source: JSON.stringify(sourceSnapshot) + '\n' });
        if (!isSsrBuild && candidate) this.emitFile({ type: 'asset', fileName: '.release/candidate.json', source: JSON.stringify(candidate) + '\n' });
        for (const id of this.getModuleIds()) {
          if (!isSsrBuild && !isAllowedClientModule(id)) this.error('Server or unmigrated module leaked into the frontend graph');
        }
      },
    }],
  };
});
