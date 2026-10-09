"use client";

// Privy integration, mounted only when NEXT_PUBLIC_PRIVY_APP_ID is configured.
// Beyond login it provides (1) native gas sponsorship on Monad testnet so a Sepolia-only user
// can open and prove a dispute without holding MON, and (2) an embedded wallet for users
// without one. The Maker's Privy server wallet + policy lives in packages/maker.
import { PrivyProvider, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useEffect, type ReactNode } from "react";
import { defineChain, type Hex } from "viem";
import { CHAINS } from "@kakushi/config";
import { useWallet } from "./wallet";

const privyChains = Object.values(CHAINS).map((c) =>
  defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [c.publicRpc] } },
    blockExplorers: { default: { name: "explorer", url: c.explorer } },
  }),
);

function Bridge() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const { setPrivyBridge } = useWallet();
  const w = wallets[0];
  useEffect(() => {
    setPrivyBridge({
      address: authenticated && w ? (w.address as Hex) : null,
      ready,
      login,
      logout: () => void logout(),
      provider: async () => {
        if (!w) throw new Error("no Privy wallet");
        return (await w.getEthereumProvider()) as never;
      },
      switchChain: async (chainId) => {
        if (w) await w.switchChain(chainId);
      },
      sendSponsored: async (tx) => {
        // Privy native gas sponsorship (Monad testnet is supported); enable it in the dashboard
        const r = await sendTransaction(
          { to: tx.to, data: tx.data, value: tx.value ?? 0n, chainId: CHAINS.monadTestnet.chainId },
          { sponsor: true } as never,
        );
        return r.hash as Hex;
      },
    });
    return () => setPrivyBridge(null);
  }, [ready, authenticated, w, login, logout, sendTransaction, setPrivyBridge]);
  return null;
}

export function MaybePrivy({ appId, children }: { appId: string | null; children: ReactNode }) {
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet", "email", "google"],
        appearance: { theme: "dark", accentColor: "#FF4D2E", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        supportedChains: privyChains,
        defaultChain: privyChains[0],
      }}
    >
      <Bridge />
      {children}
    </PrivyProvider>
  );
}
