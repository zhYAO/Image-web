import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
const deploymentEnvironment = process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV;

if (deploymentEnvironment === 'production' && dataMode === 'mock') {
  throw new Error('NEXT_PUBLIC_DATA_MODE=mock is forbidden in production. Use http.');
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  output: 'standalone',
  env: { ZIMAGE_BUILD_SHA: process.env.ZIMAGE_BUILD_SHA ?? 'development' },
  generateBuildId: async () => process.env.ZIMAGE_BUILD_SHA ?? null,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental:
    process.env.ZIMAGE_BUILD_CPUS === '1'
      ? { cpus: 1, webpackMemoryOptimizations: true, webpackBuildWorker: true }
      : undefined,
  transpilePackages: ['@zimage/domain'],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
