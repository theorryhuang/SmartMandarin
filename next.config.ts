import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Required for Gemini Live WebRTC connections
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
