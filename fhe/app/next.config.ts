import type { NextConfig } from "next";

// Privy's embedded wallet lives in a cross-origin iframe (auth.privy.io) and its login can use popups;
// cross-origin isolation (COEP) blocks such iframes. So isolation, which only buys tfhe's threaded
// WASM a speed-up, is on only while Privy is not configured. Single-threaded encryption still works.
const privy = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

const config: NextConfig = {
  transpilePackages: ["@kakushi/fhe-sdk"],
  // without an app ID, swap Privy's React SDK for a stub so it is not compiled or shipped at all
  turbopack: privy ? {} : { resolveAlias: { "@privy-io/react-auth": "./src/lib/pay/privy-stub.ts" } },
  experimental: {
    // the dev filesystem cache costs hundreds of MB on disk; opt back in with NEXT_DEV_FS_CACHE=1
    turbopackFileSystemCacheForDev: process.env.NEXT_DEV_FS_CACHE === "1",
  },
  async headers() {
    if (privy) return [];
    return [
      {
        source: "/:path*",
        headers: [
          // Cross-origin isolation lets Zama's tfhe WASM use a thread pool in the browser.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default config;
