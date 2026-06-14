/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build autonome pour l'image Docker (cf. Dockerfile : .next/standalone)
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

module.exports = nextConfig;
