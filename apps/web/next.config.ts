import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs/config';
import { publicAssetRemotePatterns } from './build/static-assets-config.mjs';

const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
const deploymentEnvironment = process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV;
const slimBuild = process.env.ZIMAGE_BUILD_SLIM === '1';

if (deploymentEnvironment === 'production' && dataMode === 'mock') {
  throw new Error('NEXT_PUBLIC_DATA_MODE=mock is forbidden in production. Use http.');
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  output: 'standalone',
  ...(process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL ? {
    images: { remotePatterns: publicAssetRemotePatterns(process.env.NEXT_PUBLIC_STATIC_ASSET_BASE_URL) },
  } : {}),
  env: { ZIMAGE_BUILD_SHA: process.env.ZIMAGE_BUILD_SHA ?? 'development' },
  generateBuildId: async () => process.env.ZIMAGE_BUILD_SHA ?? null,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  ...(slimBuild ? {
    outputFileTracingExcludes: {
      // Pinned Next production standalone always starts with isDev:false.
      // Exclude the guarded development roots before NFT walks their children.
      'next-server': [
        '**/next/dist/server/lib/router-utils/setup-dev-bundler.js',
        '**/next/dist/server/dev/next-dev-server.js',
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

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
