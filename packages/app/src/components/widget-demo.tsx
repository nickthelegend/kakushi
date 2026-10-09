"use client";

import { KakushiPay } from "@kakushi/widget";
import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";
import { short } from "@/components/kit";
import { usePrivacyChains } from "@/lib/privacy";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";

/** A sample checkout with the real widget: pays the merchant privately on Monad. */
export function WidgetDemo() {
  const { k } = useRuntime();
  const w = useWallet();
  const { chains } = usePrivacyChains();
  const pc = chains.find((c) => c.chain.key === "monadTestnet") ?? chains[0];
  const [to, setTo] = useState("");
  const [paid, setPaid] = useState<string | null>(null);
  useEffect(() => {
    if (w.address && !to) setTo(w.address);
  }, [w.address, to]);
  if (!pc || !k) {
    return <p className="text-[14px] text-ui-muted">The live demo appears once the privacy contracts are deployed on this network.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-[24px] bg-white p-6 text-[#13141f]">
        <div className="flex items-center gap-2 text-[13px] text-[#6e7080]">
          <Coffee size={15} /> Any shop&rsquo;s checkout
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-[18px] font-medium">Flat white</span>
          <span className="text-[18px] font-semibold">0.05 MON</span>
        </div>
        <div className="mt-5">
          <KakushiPay
            to={to}
            amount="0.05"
            token="native"
            walletClient={w.address ? () => w.walletClient(pc.chain.key) : null}
            publicClient={k.client(pc.chain.key)}
            deployment={pc.privacy}
            label="Pay privately"
            theme={{ width: "100%" }}
            onPaid={(r) => setPaid(r.stealthAddress)}
          />
        </div>
        {paid ? <p className="mt-3 text-[13px] text-[#2f47f5]">Paid to one-time address {short(paid)}</p> : null}
      </div>
      <div className="rounded-[24px] bg-[#04060f]/80 p-6 ring-1 ring-white/[0.06]">
        <label className="block text-[13px] text-ui-muted">
          Merchant (wallet or st:eth: address)
          <input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x… merchant" className="mt-2 w-full rounded-full bg-ui-surface-2 px-4 py-2.5 font-mono text-[13px] text-ui-text outline-none" />
        </label>
        <p className="mt-4 text-[14px] text-ui-muted">Pay yourself, then open Receive to find it.</p>
        <pre className="mt-4 overflow-x-auto rounded-[16px] bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-[#c4d0ff]">{`<KakushiPay
  to={merchant}
  amount="0.05"
  token="native"
  deployment={privacy}
/>`}</pre>
      </div>
    </div>
  );
}
