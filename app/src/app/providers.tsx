"use client";
import type { ReactNode } from "react";
import { RuntimeProvider } from "@/lib/runtime";
import { Shell } from "@/components/Shell";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <RuntimeProvider>
      <Shell>{children}</Shell>
    </RuntimeProvider>
  );
}
