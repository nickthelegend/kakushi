"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight, Check, Coins, FileCheck2, Gavel, Send, ShieldCheck } from "lucide-react";
import { CHAINS } from "@kakushi/config";
import { windowCount } from "@kakushi/sdk";
import { Amount, Button, Card, Pill, Stat } from "@/components/ui";
import { CommitStrip } from "@/components/CommitStrip";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";

function LiveStats() {
  const { k } = useRuntime();
  const load = useCallback(async () => {
    const makers = await k!.makers();
    const margins = await Promise.all(makers.map((m) => k!.margin(m, CHAINS.monadTestnet.usdc.address)));
    return { makers: makers.length, margin: margins.reduce((a, b) => a + b.margin, 0n), windows: await windowCount(k!.hub, k!.d.hub.attestationOracle) };
  }, [k]);
  const { data } = usePoll(k ? load : null, 6000, [k]);
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat label="Makers" value={data ? data.makers : "…"} />
      <Stat label="Margin on Monad" value={data ? <Amount value={data.margin} decimals={6} max={0} symbol="USDC" /> : "…"} />
      <Stat label="CRE windows" value={data ? data.windows.toLocaleString() : "…"} />
    </div>
  );
}

const STEPS = [
  { icon: Send, title: "Pay the Maker", body: "A plain transfer to a Maker's address. The last four digits of the amount say where it goes: …9001 is Monad. No approval, no bridge contract holding your money, no wrapped token." },
  { icon: Coins, title: "Get paid in seconds", body: "The Maker pays you from its own inventory on the other chain, through a PayoutRouter that logs every payout. On Monad that is under a second after your payment is final." },
  { icon: Gavel, title: "Or get their margin", body: "If the payout is missing, late or short, a Noir proof over Chainlink CRE attestations shows it, and the Maker's margin on Monad pays you the full amount. A Watchtower does this for you." },
];

const COMPARE: [string, string, string][] = [
  ["Where your funds wait", "In one bridge vault: a honeypot for every user", "Nowhere: you pay a Maker directly"],
  ["What you receive", "A wrapped IOU minted by the bridge", "The real asset, from the Maker's inventory"],
  ["Who releases funds", "A multisig or oracle says so", "The Maker pays; a proof enforces it"],
  ["Speed", "Minutes to hours", "About a second to Monad"],
  ["If something goes wrong", "Hope the vault holds", "Provable refund from slashable margin"],
  ["Your risk", "The whole bridge's TVL", "One Maker's inventory and margin, visible per transfer"],
];

export default function Landing() {
  return (
    <div className="space-y-24">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <Pill tone="accent">Monad Metropolis · Trust infrastructure</Pill>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl">
            Bridge in a second.
            <br />
            <span className="text-accent">Prove</span> you're safe.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Kakushi pays you on the other chain from a Maker's own inventory. If the Maker doesn't, a zero-knowledge proof takes their margin on Monad and gives it to you. The safety machinery stays hidden until you need it, and then anyone can check it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/bridge"><Button className="h-12 px-6">Open the bridge <ArrowRight className="size-4" /></Button></Link>
            <Link href="/attestations"><Button variant="ghost" className="h-12 px-6">See the attestations</Button></Link>
          </div>
        </div>
        <div className="space-y-3">
          <LiveStats />
          <CommitStrip />
          <Card className="p-5 text-sm text-muted">
            Disputes settle on the Monad hub. Monad finalizes a block about 600 ms after it is proposed, so a proven missed payout is paid back almost as soon as it is submitted.
          </Card>
        </div>
      </section>

      <section>
        <h2 className="text-3xl font-semibold tracking-[-0.03em]">How it works</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title}>
              <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent"><s.icon className="size-5" /></span><span className="text-sm text-dim">0{i + 1}</span></div>
              <div className="mt-4 text-lg font-semibold">{s.title}</div>
              <p className="mt-2 text-[15px] text-muted">{s.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.03em]">Safety you can verify</h2>
          <p className="mt-3 text-muted">Three independent pieces. None of them can move your money on its own say-so.</p>
          <div className="mt-6 space-y-3">
            {[
              { icon: Coins, t: "Margin, on Monad", b: "Every Maker locks at least 1.1× its largest route limit in the MDC. Withdrawals wait out every fill, attestation and dispute window. No admin, pause or upgrade can move it." },
              { icon: ShieldCheck, t: "Attestation, by Chainlink CRE", b: "A CRE workflow per chain commits every payout and payment of a block window as a sorted Poseidon2 root. Payout windows must be contiguous, so nothing can be left out." },
              { icon: FileCheck2, t: "A proof, in Noir", b: "PaymentCompliance proves your payment exists and no compliant payout does. UltraHonk verifies it on Monad and the slash happens in the same transaction." },
            ].map((x) => (
              <div key={x.t} className="flex gap-4 rounded-[20px] border border-line bg-s1 p-4">
                <x.icon className="mt-0.5 size-5 shrink-0 text-indigo" />
                <div><div className="font-medium">{x.t}</div><div className="mt-1 text-sm text-muted">{x.b}</div></div>
              </div>
            ))}
          </div>
        </div>
        <Card className="self-start">
          <div className="font-medium">What you trust, honestly</div>
          <table className="mt-4 w-full text-sm">
            <tbody className="[&_td]:py-2 [&_td]:align-top">
              <tr className="border-b border-line"><td className="pr-3 text-ok">Trustless</td><td className="text-muted">fee math, the ident code, absence or non-compliance of a payout, who gets slashed (the proven sender), replay protection</td></tr>
              <tr className="border-b border-line"><td className="pr-3 text-indigo">Chainlink</td><td className="text-muted">that each attested root is the true set of logs in its block window (a DON reaching consensus)</td></tr>
              <tr><td className="pr-3 text-warn">Demo assumption</td><td className="text-muted">normalized leaves rather than receipt-trie proofs; 3 confirmations on Sepolia and Base Sepolia instead of finality; local runs use CRE's simulation forwarder</td></tr>
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h2 className="text-3xl font-semibold tracking-[-0.03em]">Lock-and-mint vs Kakushi</h2>
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-5 py-3 font-normal" /><th className="px-3 py-3 font-normal">Lock-and-mint bridge</th><th className="px-5 py-3 font-normal">Kakushi</th></tr></thead>
            <tbody>
              {COMPARE.map(([row, a, b]) => (
                <tr key={row} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 font-medium">{row}</td>
                  <td className="px-3 py-3 text-muted">{a}</td>
                  <td className="px-5 py-3"><span className="inline-flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-ok" />{b}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <h2 className="text-3xl font-semibold tracking-[-0.03em]">Questions</h2>
        <div className="space-y-2">
          {[
            ["What if I type the wrong amount?", "If the last four digits aren't a registered route, the Maker must refund you on the source chain, minus a small fee. That refund is enforced by the same proof and margin as a fill."],
            ["Why ZK if Chainlink attests?", "CRE commits only data: one root per block window. The proof does the judging over it (your payment, the code, the fee math, the missing payout) at a fixed on-chain cost, and the roots can later come from a light client without changing the circuit."],
            ["Who runs the Makers?", "Anyone. Register routes and fees on the EBC, post margin on Monad, and run the open-source Maker node. Quotes compete on price; the margin shown is what backs your transfer."],
            ["Which chains?", "USDC between Sepolia and Monad testnet, and native ETH between Sepolia and Base Sepolia. Adding a chain is a config entry and an adapter."],
          ].map(([q, a]) => (
            <details key={q} className="group rounded-[20px] border border-line bg-s1 px-5 py-4">
              <summary className="cursor-pointer list-none font-medium">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-accent/30 bg-accent-soft p-10 text-center">
        <h2 className="text-3xl font-semibold tracking-[-0.03em]">Send something across.</h2>
        <p className="mt-2 text-muted">USDC to Monad in about a second, backed by margin you can see.</p>
        <Link href="/bridge"><Button className="mt-6 h-12 px-6">Open the bridge <ArrowRight className="size-4" /></Button></Link>
      </section>
    </div>
  );
}
