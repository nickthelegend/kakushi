import type { NextConfig } from "next";

const config: NextConfig = {
  // workspace packages ship TypeScript source
  transpilePackages: ["@kakushi/sdk", "@kakushi/config", "@kakushi/attest-core", "@kakushi/ui", "@kakushi/widget", "@kakushi/fhe-sdk"],
  reactStrictMode: true,
  output: process.env.KAKUSHI_NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  experimental: { cpus: 1 },
  // node-only modules in @kakushi/config/deployments are only imported by route handlers
  serverExternalPackages: [],
  // Cross-origin isolation ONLY where Kakushi Confidential encrypts in the browser: it gives tfhe's
  // WASM a thread pool (SharedArrayBuffer). Everything else keeps default headers. With Privy
  // configured, isolation stays off (COEP blocks Privy's cross-origin iframe) and encryption runs
  // single-threaded.
  async headers() {
    if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) return [];
    const isolation = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];
    return [
      { source: "/confidential", headers: isolation },
      { source: "/confidential/:path*", headers: isolation },
      // tfhe's thread-pool workers: a cross-origin-isolated page may only start workers whose own
      // response carries a compatible COEP
      { source: "/vendor/:path*", headers: isolation },
    ];
  },
};

export default config;
