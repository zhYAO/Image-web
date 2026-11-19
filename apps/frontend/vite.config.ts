import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { frontendAliases } from './build/aliases';
import { assertClientSource, isAllowedClientModule } from './build/client-boundary';
import { namespacePublicAssetSource } from './build/public-asset-source';
import { validateCandidateDescriptor, validateCandidateMetadata } from './scripts/candidate-metadata.mjs';
import { readBuildSource, assertBuildSourceUnchanged, readSourceSnapshot } from './scripts/build-source-identity.mjs';
import { devAssets } from './build/dev-assets';
import { devProxyOptions, localBackendOrigin } from './build/dev-runtime.mjs';
import { readImageDelivery, previewMetadataPath } from './build/image-delivery.mjs';
import { verifyBuildPublicImages, publicImageMetadataPath, publicImageContract } from '../web/build/public-image-build.mjs';

export default defineConfig(({ command, isSsrBuild }) => {
  // Explicit, non-secret build inputs only. Never map process.env or VITE_*.
  if (command === 'serve' && !process.env.ZIMAGE_DEV_BACKEND_ORIGIN) throw new Error('Use pnpm dev:split to verify a local backend before starting the frontend.');
  const namespace = command === 'build' ? process.env.ZIMAGE_ASSET_NAMESPACE ?? '' : '';
  const imageDelivery = readImageDelivery(process.env.ZIMAGE_IMAGE_DELIVERY, process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL);
  if (command === 'build' && (namespace === 'none' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(namespace))) throw new Error('An explicit frontend asset namespace is required');
  let descriptor: unknown;
  try { descriptor = process.env.ZIMAGE_FRONTEND_COMPATIBILITY ? JSON.parse(process.env.ZIMAGE_FRONTEND_COMPATIBILITY) : undefined; }
  catch { throw new Error('Invalid frontend compatibility descriptor'); }
  const candidateDescriptor = validateCandidateDescriptor(descriptor);
  let backendOrigin: string | undefined;
  if (command === 'serve') {
    backendOrigin = localBackendOrigin(process.env.ZIMAGE_DEV_BACKEND_ORIGIN);
    if (!/^[a-f0-9]{40}$/.test(process.env.ZIMAGE_DEV_BACKEND_SHA ?? '')
      || candidateDescriptor.allowedBackendReleases.length !== 1
      || candidateDescriptor.allowedBackendReleases[0] !== process.env.ZIMAGE_DEV_BACKEND_SHA) throw new Error('Development backend identity does not match its descriptor.');
  }
  let sourceSnapshot: ReturnType<typeof readBuildSource> | undefined;
  return {
    root: fileURLToPath(new URL('./', import.meta.url)),
    envDir: false,
    envPrefix: [],
    publicDir: false,
    base: namespace ? `/frontend-assets/${namespace}/` : '/',
    esbuild: { jsx: 'automatic' },
    define: {
      __ZIMAGE_ASSET_NAMESPACE__: JSON.stringify(namespace),
      __ZIMAGE_PUBLIC_IMAGE_BASE__: JSON.stringify(imageDelivery?.baseUrl ?? ''),
      __ZIMAGE_COMPATIBILITY__: JSON.stringify(descriptor ?? null),
    },
    server: { host: '127.0.0.1', strictPort: true, ...(backendOrigin ? { proxy: devProxyOptions(backendOrigin) } : {}) },
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
        const adapted = namespacePublicAssetSource(code, id, namespace, imageDelivery?.baseUrl);
        assertClientSource(adapted, id);
        return adapted;
      },
      async buildStart() {
        if (command !== 'build') return;
        if (imageDelivery && process.env.ZIMAGE_IMAGE_DELIVERY !== 'external-preview') await verifyBuildPublicImages(imageDelivery.baseUrl);
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
        if (!isSsrBuild && imageDelivery) {
          const preview = process.env.ZIMAGE_IMAGE_DELIVERY === 'external-preview';
          this.emitFile({ type: 'asset', fileName: preview ? previewMetadataPath : publicImageMetadataPath,
            source: JSON.stringify(preview ? imageDelivery : publicImageContract(imageDelivery.baseUrl)) + '\n' });
        }
        for (const id of this.getModuleIds()) {
          if (!isSsrBuild && !isAllowedClientModule(id)) this.error('Server or unmigrated module leaked into the frontend graph');
        }
      },
    }, ...(command === 'serve' ? [devAssets(fileURLToPath(new URL('../web/public', import.meta.url)))] : [])],
  };
});
