/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // wallet-adapter pulls in some packages that need node fallbacks in the browser
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
