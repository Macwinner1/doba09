import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // @feyi/shared ships TypeScript-compiled CJS from the workspace; Next has to
  // transpile it rather than treat it as a prebuilt external.
  transpilePackages: ['@feyi/shared'],

  async rewrites() {
    // Same-origin proxy to the API. Without it the auth cookies would be
    // cross-site in development, which modern browsers block by default.
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
    ];
  },
};

export default nextConfig;
