"use client";

import type { ReactNode } from "react";
import { RuntimeProvider } from "@/lib/runtime";
import { WalletProvider } from "@/lib/wallet";
import { Shell } from "@/components/Shell";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RuntimeProvider>
      <WalletProvider>
        <Shell>{children}</Shell>
      </WalletProvider>
    </RuntimeProvider>
  );
}
