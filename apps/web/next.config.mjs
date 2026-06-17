/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume workspace TS packages directly (no build step in dev).
  transpilePackages: ['@departments/shared', '@departments/events', '@departments/realtime'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
