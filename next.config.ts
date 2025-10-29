import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3001", "http://192.168.100.55:3001"],

  webpack: (config, { isServer }) => {
    // --- SERVER-SIDE CONFIGURATION ---
    // For native tree-sitter packages used in API routes.
    if (isServer) {
      config.externals.push(
        "tree-sitter",
        "tree-sitter-python",
        "tree-sitter-javascript",
        "tree-sitter-typescript"
      );
    }

    // --- CLIENT-SIDE CONFIGURATION ---
    // For web-tree-sitter used in browser components.
    if (!isServer) {
      // The browser doesn't have Node.js modules, so we provide empty substitutes.
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
        os: false,
        module: false, // This is the key fix for the "Can't resolve 'module'" error
      };
    }

    return config;
  },
};

export default nextConfig;
