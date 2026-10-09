"use client";

// The signature moment: an amount whose last four digits are the destination, stamped like a
// hanko. The digits roll, then the seal lands. Click a code to see where else it can go.
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "./ui";

const CODES = [
  { code: "9001", chain: "Monad testnet", note: "USDC from Sepolia" },
  { code: "9002", chain: "Ethereum Sepolia", note: "USDC from Monad, ETH from Base" },
  { code: "9003", chain: "Base Sepolia", note: "ETH from Sepolia" },
];

export function AmountSeal({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(CODES[0]!.code);
  const [stamp, setStamp] = useState(0);
  const auto = useRef(true);

  useEffect(() => {
    const target = CODES[i]!.code;
    if (reduced) {
      setShown(target);
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      n++;
      if (n > 9) {
        clearInterval(id);
        setShown(target);
        setStamp((s) => s + 1);
        return;
      }
      setShown(Array.from({ length: 4 }, (_, k) => (n > 3 + k * 1.5 ? target[k] : String(Math.floor(Math.random() * 10)))).join(""));
    }, 55);
    return () => clearInterval(id);
  }, [i, reduced]);

  useEffect(() => {
    const id = setInterval(() => auto.current && setI((x) => (x + 1) % CODES.length), 4200);
    return () => clearInterval(id);
  }, []);

  const cur = CODES[i]!;
  return (
    <div className={className}>
      <div className="font-display text-[clamp(44px,8.4vw,104px)] leading-none font-bold tracking-[-0.02em] tabular">
        100.00
        <span key={stamp} className={cn("seal ml-1 inline-block", !reduced && "seal-in")} aria-label={`code ${cur.code}`}>
          {shown}
        </span>
        <span className="ml-3 align-middle font-sans text-[0.22em] font-medium tracking-normal text-muted">USDC</span>
      </div>
      <p className="mt-5 max-w-md text-[15px] text-muted">
        The last four digits, <span className="text-accent tabular">{cur.code}</span>, send it to <span className="text-text">{cur.chain}</span>. No form, no memo, no approval: the amount carries the route.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Destination codes">
        {CODES.map((c, k) => (
          <button
            key={c.code}
            role="tab"
            aria-selected={k === i}
            onClick={() => {
              auto.current = false;
              setI(k);
            }}
            className={cn("rounded-[8px] border px-3 py-1.5 text-sm transition tabular", k === i ? "border-accent/60 text-text" : "border-line text-muted hover:text-text")}
          >
            <span className={k === i ? "text-accent" : ""}>{c.code}</span> {c.chain}
          </button>
        ))}
      </div>
    </div>
  );
}
