/** @type {import('next').NextConfig} */

// The API is proxied through this app's own origin (/api/* -> backend) so the
// session cookie is first-party. Cross-site cookies (Vercel page, Railway API)
// are blocked by Safari and increasingly by Chrome, which broke sign-in.
const API_TARGET = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig = {
  reactStrictMode: true,
  // Packages in the monorepo are shipped as TS/ESM and transpiled by Next.
  transpilePackages: ["@workos/types", "@workos/ui"],
  eslint: {
    // Lint is run separately via turbo; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/:path*` }];
  },
};

export default nextConfig;
