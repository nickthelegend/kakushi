"use client";
import type { ReactNode } from "react";
import { RuntimeProvider } from "@/lib/runtime";
import { PayWalletProvider } from "@/lib/pay/wallet";
import { Shell } from "@/components/Shell";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <RuntimeProvider>
      <PayWalletProvider>
        <Shell>{children}</Shell>
      </PayWalletProvider>
    </RuntimeProvider>
  );
}
