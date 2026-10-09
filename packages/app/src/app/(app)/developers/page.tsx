"use client";

import { CodeBlock, type CodeSample } from "@kakushi/ui";
import { Boxes, EyeOff, Package, Shield, Zap } from "lucide-react";
import { developers } from "@/components/landing/content";

const STEPS = [
  { icon: <Package size={18} />, title: "Install", body: "pnpm add @kakushi/sdk" },
  { icon: <EyeOff size={18} />, title: "Pay privately", body: "Send to a meta-address" },
  { icon: <Shield size={18} />, title: "Shield", body: "Deposit, withdraw with a proof" },
  { icon: <Zap size={18} />, title: "Go gasless", body: "Point at a relayer" },
];

export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-[1100px] pt-6 sm:pt-10">
      <header className="text-center">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[#3a5cf0] px-3 text-[13px] font-medium text-white">
          <Boxes aria-hidden size={13} /> SDK
        </span>
        <h1 className="mt-4 text-[clamp(40px,5.5vw,72px)] leading-[1.02]">Make your app private.</h1>
      </header>
      <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-[22px] bg-ui-surface-1/80 p-5 ring-1 ring-ui-hairline-strong backdrop-blur">
            <span className="flex items-center justify-between text-[#8ea5ff]">{s.icon}<span className="serif text-[22px] text-white/20">{i + 1}</span></span>
            <h2 className="mt-3 text-[17px] font-medium">{s.title}</h2>
            <p className="mt-1 font-mono text-[13px] text-ui-muted">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <CodeBlock aria-label="Kakushi SDK examples" note={developers.note} copyable defaultKey="send" samples={developers.samples as unknown as CodeSample[]} />
      </div>
    </div>
  );
}
