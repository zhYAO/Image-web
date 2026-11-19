import type { NextConfig } from 'next';
import path from 'node:path';
import { publicAssetRemotePatterns } from './build/static-assets-config.mjs';
import { resolvePublicImageBase } from './build/public-image-base.mjs';
import { verifyBuildPublicImages, publicImageContract } from './build/public-image-build.mjs';

export default async function createNextConfig(): Promise<NextConfig> {
  const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
  const deploymentEnvironment = process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV;
  const slimBuild = process.env.ZIMAGE_BUILD_SLIM === '1';
  const sharedImageBase = process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL;
  const legacyAssetBase = process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL;
  const imageBase = resolvePublicImageBase(sharedImageBase, legacyAssetBase);

  if (deploymentEnvironment === 'production' && dataMode === 'mock') {
    throw new Error('NEXT_PUBLIC_DATA_MODE=mock is forbidden in production. Use http.');
  }

  if (sharedImageBase) await verifyBuildPublicImages(imageBase!);

  const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1'],
    devIndicators: false,
    distDir: process.env.NEXT_DIST_DIR ?? '.next',
    reactStrictMode: true,
    output: 'standalone',
    ...(imageBase ? {
      images: { remotePatterns: publicAssetRemotePatterns(imageBase) },
    } : {}),
    env: { ZIMAGE_BUILD_SHA: process.env.ZIMAGE_BUILD_SHA ?? 'development', ZIMAGE_PUBLIC_IMAGE_BASE_URL: sharedImageBase ? imageBase! : '',
      ZIMAGE_PUBLIC_IMAGE_CONTRACT: sharedImageBase ? JSON.stringify(publicImageContract(imageBase!)) : '' },
    generateBuildId: async () => process.env.ZIMAGE_BUILD_SHA ?? null,
    outputFileTracingRoot: path.join(__dirname, '../..'),
    ...(slimBuild ? {
      outputFileTracingExcludes: {
        // Pinned Next production standalone always starts with isDev:false.
        // Exclude the guarded development roots before NFT walks their children.
        'next-server': [
          '**/next/dist/server/lib/router-utils/setup-dev-bundler.js',
          '**/next/dist/server/dev/next-dev-server.js',
          // Isolated Webpack-only comparison: the Turbopack runtime is not selected.
          '**/next/dist/compiled/next-devtools/index.js',
          '**/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js',
          '**/next/dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js',
        ],
      },
    } : {}),
    experimental: {
      // Next 16.3 can panic while restoring the dev cache (TaskGuard has no
      // persistent_task_type). Keep HMR/in-memory caching, skip disk restore.
      turbopackFileSystemCacheForDev: false,
      ...(process.env.ZIMAGE_BUILD_CPUS === '1'
        ? { cpus: 1, webpackMemoryOptimizations: true, webpackBuildWorker: true }
        : {}),
    },
    transpilePackages: ['@zimage/domain'],
  };
  return nextConfig;
}
