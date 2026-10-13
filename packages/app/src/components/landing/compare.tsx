"use client";

import { Check, Minus, X } from "lucide-react";
import { Rise } from "@/components/motion";
import { SectionIntro, Shell } from "./section";

type Mark = "yes" | "part" | "no";
/** Kakushi against the two privacy designs people know. Kept to what each design does by construction. */
const ROWS: { k: string; umbra: [Mark, string]; pool: [Mark, string]; kakushi: [Mark, string] }[] = [
  { k: "Hides who gets paid", umbra: ["yes", "Stealth addresses"], pool: ["part", "Fresh withdrawal address"], kakushi: ["yes", "Stealth addresses"] },
  { k: "Hides where funds came from", umbra: ["no", "Sender is public"], pool: ["yes", "ZK withdrawal"], kakushi: ["yes", "ZK pool"] },
  { k: "Hides how much", umbra: ["no", "Amounts public"], pool: ["part", "Fixed sizes only"], kakushi: ["yes", "FHE-encrypted amounts"] },
  { k: "Compute on private data", umbra: ["no", "No"], pool: ["no", "No"], kakushi: ["yes", "FHE.sol in any contract"] },
  { k: "Across chains", umbra: ["no", "Per chain"], pool: ["no", "One chain"], kakushi: ["yes", "Private bridge to stealth"] },
  { k: "Gasless for the receiver", umbra: ["yes", "Relayer"], pool: ["yes", "Relayer"], kakushi: ["yes", "Relayer"] },
  { k: "For other apps", umbra: ["part", "JS library"], pool: ["no", "Own app"], kakushi: ["yes", "SDK + React widget"] },
  { k: "Proof system", umbra: ["no", "None needed"], pool: ["part", "Groth16, trusted setup"], kakushi: ["yes", "Noir UltraHonk, universal setup"] },
];

function Cell({ v }: { v: [Mark, string] }) {
  const [m, t] = v;
  return (
    <span className="flex items-start gap-2">
      {m === "yes" ? <Check aria-label="yes" size={16} className="mt-0.5 shrink-0 text-[#8ea5ff]" /> : m === "part" ? <Minus aria-label="partly" size={16} className="mt-0.5 shrink-0 text-ui-muted" /> : <X aria-label="no" size={16} className="mt-0.5 shrink-0 text-ui-down/80" />}
      {t}
    </span>
  );
}

export function Compare() {
  return (
    <section id="compare" aria-labelledby="compare-title" className="scroll-mt-24 py-16 lg:py-24">
      <Shell>
        <SectionIntro id="compare-title" align="center" eyebrow="Compare" heading={["Who and how much,", "both private."]} className="mx-auto max-w-[760px]" />
        {/* Phones: one card per row, Kakushi first. */}
        <ul className="mt-10 grid gap-3 md:hidden">
          {ROWS.map((r) => (
            <li key={r.k} className="rounded-[22px] bg-ui-surface-1/60 p-4 ring-1 ring-ui-hairline">
              <p className="text-[15px] font-medium">{r.k}</p>
              <div className="mt-3 rounded-[14px] bg-[#0b1233] px-3 py-2.5 text-[14px]">
                <span className="mb-1 block text-[12px] font-semibold text-[#c4d0ff]">Kakushi</span>
                <Cell v={r.kakushi} />
              </div>
              <dl className="mt-2.5 grid grid-cols-2 gap-3 px-1 text-[13px] text-ui-muted">
                <div><dt className="mb-1 text-[12px] text-ui-dim">Umbra</dt><dd><Cell v={r.umbra} /></dd></div>
                <div><dt className="mb-1 text-[12px] text-ui-dim">Mixer pools</dt><dd><Cell v={r.pool} /></dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <Rise y={24} className="mx-auto mt-12 hidden max-w-[1040px] overflow-x-auto rounded-[28px] ring-1 ring-ui-hairline-strong md:block">
          <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
            <caption className="sr-only">Kakushi compared with Umbra and single-chain mixer pools</caption>
            <thead>
              <tr className="bg-ui-surface-1">
                <th scope="col" className="w-[26%] px-5 py-4" />
                <th scope="col" className="px-5 py-4 text-[14px] font-medium text-ui-muted">Umbra</th>
                <th scope="col" className="px-5 py-4 text-[14px] font-medium text-ui-muted">Mixer pools</th>
                <th scope="col" className="bg-[#101a4a] px-5 py-4 text-[14px] font-semibold text-[#c4d0ff]">Kakushi</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.k} className="border-t border-ui-hairline">
                  <th scope="row" className="px-5 py-4 align-top text-[14px] font-medium">{r.k}</th>
                  <td className="px-5 py-4 align-top text-ui-muted"><Cell v={r.umbra} /></td>
                  <td className="px-5 py-4 align-top text-ui-muted"><Cell v={r.pool} /></td>
                  <td className="bg-[#0b1233] px-5 py-4 align-top"><Cell v={r.kakushi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Rise>
      </Shell>
    </section>
  );
}
