import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["http://localhost:3001", "http://192.168.100.55:3001"],
  webpack: (config, { isServer }) => {
    // Ensure client bundle doesn't try to resolve Node-only modules used by dependencies
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        os: false,
        module: false,
      };
      // Explicitly ignore the subpath as well to prevent resolution errors
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "fs/promises": false,
        module: false,
      } as typeof config.resolve.alias;
    }
    return config;
  },
};

export default nextConfig;
