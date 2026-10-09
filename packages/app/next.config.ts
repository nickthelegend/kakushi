import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source
  transpilePackages: ["@kakushi/sdk", "@kakushi/config", "@kakushi/attest-core"],
  reactStrictMode: true,
  output: process.env.KAKUSHI_NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: { cpus: 1 },
  // node-only modules in @kakushi/config/deployments are only imported by route handlers
  serverExternalPackages: [],
};

export default config;
