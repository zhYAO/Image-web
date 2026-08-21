import type { NextConfig } from 'next';

const dataMode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
const deploymentEnvironment = process.env.VERCEL_ENV ?? process.env.ZIMAGE_DEPLOYMENT_ENV;

if (deploymentEnvironment === 'production' && dataMode === 'mock') {
  throw new Error('NEXT_PUBLIC_DATA_MODE=mock is forbidden in production. Use http.');
}

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ['@zimage/domain'],
};

export default nextConfig;
