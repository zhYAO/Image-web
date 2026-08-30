import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
const deploymentEnvironment = process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV;

if (deploymentEnvironment === 'production' && dataMode === 'mock') {
  throw new Error('NEXT_PUBLIC_DATA_MODE=mock is forbidden in production. Use http.');
}

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  transpilePackages: ['@zimage/domain'],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
