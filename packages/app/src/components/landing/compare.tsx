"use client";

import { Check, Minus } from "lucide-react";
import { Rise } from "@/components/motion";
import { SectionIntro, Shell } from "./section";

/** Kakushi against Orbiter Finance, row by row. Orbiter's figures are its published ones. */
const ROWS: { k: string; orbiter: string; kakushi: string; win: boolean }[] = [
  { k: "Time to receive", orbiter: "10 to 20 seconds", kakushi: "About a second into Monad", win: true },
  { k: "How you pay", orbiter: "Transfer to a Maker's EOA, route in the last digits", kakushi: "The same, plus an optional router", win: false },
  { k: "Fees", orbiter: "0.03 to 0.30% plus gas", kakushi: "Each Maker's quote, from 0.10%, shown before you send", win: false },
  { k: "If a Maker doesn't pay", orbiter: "ZK-SPV arbitration; small claims can cost more than they recover", kakushi: "A Noir proof built in your browser; Monad pays you from margin in one transaction", win: true },
  { k: "Margin", orbiter: "Maker Deposit Contract", kakushi: "On Monad, shown on every quote, withdrawals timelocked", win: true },
  { k: "Who watches", orbiter: "You, or a submitter", kakushi: "A public Watchtower proves missed payouts for you", win: true },
  { k: "Payout data", orbiter: "SPV proofs per chain", kakushi: "Chainlink CRE commits every payout window to Monad", win: true },
  { k: "Chains", orbiter: "70+ mainnets", kakushi: "Monad and 4 testnet spokes; a new chain is a config entry", win: false },
];

export function Compare() {
  return (
    <section id="compare" aria-labelledby="compare-title" className="scroll-mt-24 py-16 lg:py-24">
      <Shell>
        <SectionIntro id="compare-title" align="center" eyebrow="Kakushi vs Orbiter" heading={["Orbiter's model,", "rebuilt for Monad."]} sub="Same idea you already trust: Makers pay you from their own liquidity. Kakushi makes it faster on Monad and makes a missed payout cheap to prove." className="mx-auto max-w-[760px]" />
        <Rise y={24} className="mx-auto mt-12 max-w-[1040px] overflow-hidden rounded-[28px] ring-1 ring-ui-hairline-strong">
          <table className="w-full border-collapse text-left text-[15px]">
            <caption className="sr-only">Kakushi compared with Orbiter Finance</caption>
            <thead>
              <tr className="bg-ui-surface-1">
                <th scope="col" className="w-[24%] px-5 py-4 text-[13px] font-medium text-ui-muted" />
                <th scope="col" className="px-5 py-4 text-[14px] font-medium text-ui-muted">Orbiter Finance</th>
                <th scope="col" className="bg-[#101a4a] px-5 py-4 text-[14px] font-semibold text-[#c4d0ff]">Kakushi</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.k} className="border-t border-ui-hairline">
                  <th scope="row" className="px-5 py-4 align-top text-[14px] font-medium">{r.k}</th>
                  <td className="px-5 py-4 align-top text-ui-muted">{r.orbiter}</td>
                  <td className="bg-[#0b1233] px-5 py-4 align-top">
                    <span className="flex gap-2">
                      {r.win ? <Check aria-hidden size={16} className="mt-0.5 shrink-0 text-[#8ea5ff]" /> : <Minus aria-hidden size={16} className="mt-0.5 shrink-0 text-ui-muted" />}
                      {r.kakushi}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rise>
        <p className="mx-auto mt-4 max-w-[1040px] text-[12px] text-ui-muted">Orbiter figures are from its public docs and third-party reviews. Kakushi runs on testnets today; its time to receive is measured on local forks.</p>
      </Shell>
    </section>
  );
}
