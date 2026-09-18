/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Packages in the monorepo are shipped as TS/ESM and transpiled by Next.
  transpilePackages: ["@workos/types", "@workos/ui"],
  eslint: {
    // Lint is run separately via turbo; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
