import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native Node addon — must not be bundled by webpack
  serverExternalPackages: ["better-sqlite3"],
  // Tell Vercel's file tracer to include the SQLite DB in every API route bundle
  outputFileTracingIncludes: {
    "/api/define-word": ["./data/cedict.db"],
  },
  experimental: {
    // Required for Gemini Live WebRTC connections
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
