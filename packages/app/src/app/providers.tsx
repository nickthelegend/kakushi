"use client";

import type { ReactNode } from "react";
import { RuntimeProvider, useRuntime } from "@/lib/runtime";
import { WalletProvider } from "@/lib/wallet";
import { MaybePrivy } from "@/lib/privy";
import { StealthKeysProvider } from "@/lib/stealth-keys";

function PrivyGate({ children }: { children: ReactNode }) {
  const { cfg } = useRuntime();
  return <MaybePrivy appId={cfg?.privyAppId ?? null}>{children}</MaybePrivy>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RuntimeProvider>
      <WalletProvider>
        <PrivyGate>
          <StealthKeysProvider>{children}</StealthKeysProvider>
        </PrivyGate>
      </WalletProvider>
    </RuntimeProvider>
  );
}
