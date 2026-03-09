import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/gcc',
        destination: '/gcc/index.html',
      },
      {
        source: '/gcc/:path((?!assets/).*)',
        destination: '/gcc/index.html',
      },
    ];
  },
};

export default nextConfig;
