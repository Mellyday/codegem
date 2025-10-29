import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3001", "http://192.168.100.55:3001"],

  webpack: (config, { isServer }) => {
    // We must tell webpack NOT to bundle ANY of the tree-sitter packages.
    // This includes the core library and all language grammars.
    if (isServer) {
      config.externals.push(
        "tree-sitter",
        "tree-sitter-python",
        "tree-sitter-javascript", // From your earlier logs
        "tree-sitter-typescript" // From your earlier logs
      );
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        os: false,
      };
    }

    return config;
  },
};

export default nextConfig;
