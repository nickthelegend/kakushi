import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@fhish/sdk"],
  // Cross-origin isolation lets Zama's tfhe WASM use a thread pool in the browser.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default config;
