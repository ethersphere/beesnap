/** @type {import('next').NextConfig} */
const config = {
  // Static export so the install page can be served by any static host (or
  // by the existing nginx in front of the backend, like the v0 dApp was).
  ...(process.env.NODE_ENV === 'production' && {
    output: 'export',
    assetPrefix: './',
  }),

  images: {
    unoptimized: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },
};

export default config;
