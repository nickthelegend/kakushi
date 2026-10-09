"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowUpRight } from "lucide-react";
import { CHAINS } from "@kakushi/config";
import { windowCount } from "@kakushi/sdk";
import { Amount, Button } from "@/components/ui";
import { AmountSeal } from "@/components/AmountSeal";
import { Art } from "@/components/Art";
import { CommitStrip } from "@/components/CommitStrip";
import { useRuntime } from "@/lib/runtime";
import { usePoll } from "@/lib/usePoll";

function LiveLine() {
  const { k, cfg } = useRuntime();
  const load = useCallback(async () => {
    const makers = await k!.makers();
    const margins = await Promise.all(makers.map((m) => k!.margin(m, CHAINS.monadTestnet.usdc.address)));
    return { makers: makers.length, margin: margins.reduce((a, b) => a + b.margin, 0n), windows: await windowCount(k!.hub, k!.d.hub.attestationOracle) };
  }, [k]);
  const { data } = usePoll(k ? load : null, 6000, [k]);
  if (!data) return <p className="text-sm text-dim">Reading the hub on Monad…</p>;
  return (
    <p className="text-sm text-muted">
      Right now {data.makers} Makers back transfers with <span className="text-text"><Amount value={data.margin} decimals={6} max={0} /> USDC</span> of margin on Monad, and Chainlink CRE has attested {data.windows.toLocaleString()} block windows{cfg?.network === "local" ? " (local forks)" : ""}.
    </p>
  );
}

const JOURNEY = [
  { t: "You pay a Maker", b: "A plain transfer to the Maker's address on the source chain. Nothing is locked in a bridge contract, and nothing wrapped is minted." },
  { t: "The Maker pays you", b: "From its own inventory on the destination chain, through a PayoutRouter that records every payout. To Monad that takes about a second." },
  { t: "Or the proof pays you", b: "If the payout is missing, late or short, anyone can prove it with Noir over CRE-attested data, and the Maker's margin on Monad covers the full amount." },
];

export default function Landing() {
  return (
    <div className="-mt-10">
      {/* hero: the generated bridge, with the amount as the headline object */}
      <section className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden">
        <Art src="/art/hero.webp" alt="" priority className="absolute inset-0 h-full w-full object-cover object-[70%_50%] opacity-80" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#0b1424_12%,rgba(11,20,36,0.78)_42%,rgba(11,20,36,0.05)_78%),linear-gradient(0deg,#0b1424_0%,transparent_28%),linear-gradient(180deg,#0b1424_0%,transparent_14%)]" />
        <div className="relative mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-6 lg:pt-28 lg:pb-32">
          <h1 className="max-w-3xl font-display text-[clamp(36px,5.4vw,68px)] font-bold leading-[1.08] tracking-[-0.01em]">
            The destination is hidden in the amount.
          </h1>
          <AmountSeal className="mt-10" />
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/bridge"><Button className="h-12 px-6">Open the bridge</Button></Link>
            <a href="#proof" className="px-2 text-[15px] text-muted underline decoration-line-strong underline-offset-4 hover:text-text">What happens if a Maker doesn't pay</a>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 border-t border-line pt-8 lg:grid-cols-[1fr_440px] lg:items-start">
        <LiveLine />
        <CommitStrip />
      </section>

      {/* a real sequence, so it is numbered; the line between stations is the bridge */}
      <section className="mt-28">
        <h2 className="max-w-xl font-display text-3xl font-bold sm:text-4xl">Three ways a transfer can end, and you are paid in all of them.</h2>
        <div className="relative mt-12">
          <svg className="absolute left-0 right-0 top-5 hidden h-4 w-full md:block" preserveAspectRatio="none" viewBox="0 0 1000 16" aria-hidden>
            <path d="M 20 8 L 980 8" stroke="var(--line-strong)" strokeWidth="1.5" />
            <path className="flow" d="M 20 8 L 980 8" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="6 194" />
          </svg>
          <ol className="grid gap-10 md:grid-cols-3">
            {JOURNEY.map((s, i) => (
              <li key={s.t} className="relative">
                <span className={`relative grid size-10 place-items-center rounded-[8px] border-2 bg-bg font-display text-lg font-bold ${i === 2 ? "border-accent text-accent" : "border-line-strong text-text"}`}>{i + 1}</span>
                <h3 className="mt-5 font-display text-xl font-bold">{s.t}</h3>
                <p className="mt-2 max-w-sm text-[15px] text-muted">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* the three safeguards, each with its own weight instead of three identical cards */}
      <section id="proof" className="mt-32 grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <video
            className="aspect-[4/5] w-full rounded-[18px] object-cover sm:aspect-square"
            src="/art/proof-loop.mp4"
            poster="/art/proof-poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            aria-label="An orb of value crosses a bridge; the next one stalls, a lattice seal locks around it, and the far shore pays the value back"
          />
        </div>
        <div className="lg:col-span-7 lg:pt-6">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">A missed payout is proven, not argued.</h2>
          <p className="mt-4 max-w-xl text-[17px] text-muted">
            Your browser, or a Watchtower, rebuilds the attested windows from chain data and proves in Noir that your payment exists and that no compliant payout does. Monad verifies the proof and slashes the Maker in the same transaction. Nobody has to believe anyone.
          </p>
          <dl className="mt-10 grid gap-8 sm:grid-cols-2">
            <div>
              <dt className="font-display text-lg font-bold">Margin on Monad</dt>
              <dd className="mt-1.5 text-[15px] text-muted">Each Maker locks at least 1.1 times its largest route limit. Withdrawals wait out every fill, attestation and dispute window. No admin key, pause or upgrade can move it.</dd>
            </div>
            <div>
              <dt className="font-display text-lg font-bold">Attested by Chainlink CRE</dt>
              <dd className="mt-1.5 text-[15px] text-muted">A workflow per chain commits every payment and payout of a block window as one root. Windows must be contiguous, so a payout cannot be left out to frame a Maker, or hidden to protect one.</dd>
            </div>
            <div>
              <dt className="font-display text-lg font-bold">A typo is refunded</dt>
              <dd className="mt-1.5 text-[15px] text-muted">If the last four digits aren't a route, the Maker owes you a refund on the source chain, enforced by the same proof and the same margin.</dd>
            </div>
            <div>
              <dt className="font-display text-lg font-bold">What you still trust</dt>
              <dd className="mt-1.5 text-[15px] text-muted">That each attested root is the true set of logs in its window. Today that is Chainlink's DON; later, a light client, without changing the circuit.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-32 grid items-center gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <h2 className="font-display text-3xl font-bold sm:text-4xl">No vault to drain.</h2>
          <p className="mt-4 max-w-lg text-[17px] text-muted">
            Lock-and-mint bridges keep every user's money in one contract and hand back a wrapped IOU. Kakushi never holds your funds: your risk is one Maker's inventory, and its margin backs you, shown on every quote before you send.
          </p>
          <table className="mt-8 w-full max-w-lg text-[15px]">
            <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:py-3 [&_td]:align-top">
              <tr><td className="pr-4 text-muted">Where funds wait</td><td>Nowhere. You pay the Maker directly.</td></tr>
              <tr><td className="pr-4 text-muted">What arrives</td><td>The real asset, not an IOU.</td></tr>
              <tr><td className="pr-4 text-muted">If it goes wrong</td><td>A proven refund from slashable margin.</td></tr>
            </tbody>
          </table>
        </div>
        <div className="lg:col-span-6">
          <Art src="/art/vault.webp" alt="Coins locked in a glass vault, floating over mist" className="aspect-square w-full rounded-[18px] object-cover" />
        </div>
      </section>

      <section className="mt-32 grid gap-10 lg:grid-cols-12">
        <h2 className="font-display text-3xl font-bold lg:col-span-4">Questions</h2>
        <div className="divide-y divide-line border-y border-line lg:col-span-8">
          {[
            ["How do I choose where the money goes?", "You don't type a destination. The bridge works out the exact amount for you, and its last four digits name the chain: 9001 Monad, 9002 Sepolia, 9003 Base Sepolia."],
            ["Why a zero-knowledge proof if Chainlink already attests?", "CRE commits data: one root per block window. The proof does the judging over that data at a fixed cost on-chain: your payment, the code, the fee math, the missing payout. The roots can later come from a light client without changing the circuit."],
            ["Who are the Makers?", "Anyone who posts margin on Monad, registers routes and fees, and runs the open-source Maker node. Quotes compete on price, and each shows the margin behind it."],
            ["Which chains and assets?", "USDC between Sepolia and Monad testnet, and ETH between Sepolia and Base Sepolia. A new chain is a config entry and an adapter."],
          ].map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-medium">
                {q}
                <span className="text-dim transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-[15px] text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-32 mb-6 border-t border-line pt-14">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <h2 className="max-w-xl font-display text-4xl font-bold">Send something across.</h2>
          <Link href="/bridge"><Button className="h-12 px-6">Open the bridge <ArrowUpRight className="size-4" /></Button></Link>
        </div>
      </section>
    </div>
  );
}
