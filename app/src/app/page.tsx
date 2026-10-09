"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Shoal } from "@/components/Shoal";
import { encryptInBrowser } from "@/lib/encrypt";

function Hero() {
  const [value, setValue] = useState("1337");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "done" | "error"; msg?: string; ms?: number; size?: number; threads?: boolean }>({ phase: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | undefined>();

  async function go() {
    const n = BigInt(value.replace(/\D/g, "") || "0");
    setState({ phase: "loading", msg: "Loading the tfhe WASM and the network key…" });
    try {
      const r = await encryptInBrowser(4, n);
      const rect = box.current?.getBoundingClientRect();
      setOrigin(rect ? { x: rect.width * 0.22, y: rect.height * 0.62 } : undefined);
      setBytes(r.bytes);
      setState({ phase: "done", ms: r.ms, size: r.bytes.length, threads: r.threads });
    } catch (e) {
      setState({ phase: "error", msg: (e as Error).message });
    }
  }

  return (
    <section ref={box} className="relative isolate overflow-hidden">
      <Shoal bytes={bytes} origin={origin} className="absolute inset-0 -z-10 h-full w-full" />
      <div className="mx-auto max-w-6xl px-5 pt-16 pb-28 sm:pt-24">
        <h1 className="max-w-4xl font-display text-[clamp(38px,6.6vw,84px)] font-extrabold leading-[0.98] tracking-[-0.03em]">
          Compute on numbers nobody can see.
        </h1>
        <p className="mt-7 max-w-xl text-lg text-tide">
          Fhish adds encrypted types to any Monad contract. Balances, bids and orders stay ciphertext while the contract adds, compares and moves them. Underneath is real fully homomorphic encryption.
        </p>
        <form
          className="mt-12 max-w-xl rounded-[22px] border border-kelp-strong bg-trench/80 p-5 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <label htmlFor="secret" className="text-sm text-tide">Pick a number to encrypt, right here in your browser</label>
          <div className="mt-2 flex gap-3">
            <input id="secret" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 18))} className="min-w-0 flex-1 rounded-xl border border-kelp bg-abyss px-4 font-display text-2xl font-bold tabular outline-none focus:border-biolum" />
            <button disabled={state.phase === "loading"} className="rounded-xl bg-biolum px-5 font-semibold text-abyss hover:brightness-110 disabled:opacity-60">
              {state.phase === "loading" ? "Encrypting…" : "Encrypt"}
            </button>
          </div>
          <p className="mt-3 min-h-12 text-sm text-tide" aria-live="polite">
            {state.phase === "idle" && "Zama's tfhe-rs, compiled to WASM, encrypts it under the Fhish network key. Nothing is sent anywhere."}
            {state.phase === "loading" && state.msg}
            {state.phase === "done" && (
              <>
                <span className="text-foam">{Number(value).toLocaleString()}</span> became <span className="text-biolum tabular">{state.size!.toLocaleString()} bytes</span> of ciphertext in {state.ms} ms{state.threads ? ", multi-threaded" : ""}. The bytes swimming behind this box are that ciphertext. A Fhish contract can add to it and compare it without ever seeing your number.
              </>
            )}
            {state.phase === "error" && <span className="text-reef">{state.msg}</span>}
          </p>
        </form>
      </div>
    </section>
  );
}

function Metrics() {
  const [m, setM] = useState<any>(null);
  useEffect(() => {
    fetch("/api/gw/metrics").then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null));
  }, []);
  const p = (k: string) => (m?.latencyMs?.[k]?.p50 !== undefined ? `${m.latencyMs[k].p50} ms` : null);
  const rows = [
    { what: "Encrypt an input (your device)", v: "6 to 30 ms native · see above for your browser", live: p("input") && `attestation ${p("input")}` },
    { what: "Encrypted add, euint64", v: "174 ms", live: p("op.1") },
    { what: "Encrypted compare (gt)", v: "103 ms", live: p("op.16") },
    { what: "Encrypted select", v: "158 ms", live: p("select") },
    { what: "KMS decrypt and sign", v: "~0.5 s", live: p("kms.decrypt") },
    { what: "Reveal request to on-chain callback", v: "~5 s on 1 s local blocks", live: p("request_to_callback") },
  ];
  return (
    <div className="divide-y divide-kelp border-y border-kelp">
      {rows.map((r) => (
        <div key={r.what} className="grid grid-cols-1 gap-1 py-4 sm:grid-cols-[1fr_auto_auto] sm:gap-8">
          <span>{r.what}</span>
          <span className="tabular text-tide">{r.v}</span>
          <span className="tabular text-biolum">{r.live ? `live p50 ${r.live}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

const CODE = `import {FHE} from "@fhish/lib/FHE.sol";
import {FhishConfig} from "@fhish/FhishConfig.sol";

contract SealedBid is FhishConfig {            // line 1
    euint64 highest;

    function bid(externalEuint64 enc, bytes calldata proof) external {
        euint64 b = FHE.fromExternal(enc, proof); // line 2
        highest = FHE.max(highest, b);           // computed on ciphertext
        FHE.allowThis(highest);
    }
}`;

const APPS = [
  { t: "Sealed-bid auction", b: "Every bid stays encrypted. The contract keeps an encrypted running maximum; only the winner and price are ever revealed. Losing bids are never decrypted by anyone." },
  { t: "Confidential USDC", b: "Wrap any ERC-20, including Monad USDC, and its balances and transfers become encrypted. You read your own balance with one signature; nobody else can." },
  { t: "Dark OTC desk", b: "Makers post encrypted limit prices. A taker learns only whether they crossed, and the price if they did. A miss reveals nothing, so there is nothing to front-run." },
  { t: "Private voting", b: "Ballots are encrypted booleans added into encrypted tallies. The result is revealed once, at the end, and no single vote ever is." },
];

const VS: [string, string, string, string][] = [
  ["Reveal a value", "Automatic: the KMS calls your contract back", "Two transactions plus an off-chain fetch", "Request, then fetch"],
  ["Solidity API", "fhEVM-shaped FHE.sol: ports with an import change", "FHE.sol (changes between versions)", "FHE.sol, own SDK"],
  ["Make an existing contract confidential", "Inherit FhishConfig; wrap any ERC-20", "Rewrite against their stack", "Rewrite against their stack"],
  ["Where it runs", "Monad: 300 ms blocks, ~600 ms finality", "Ethereum mainnet", "Testnets (Ethereum, Arbitrum, Base)"],
  ["Published latency", "Yes, live p50/p95 on this site", "Not published", "Research benchmarks"],
  ["Who holds the decryption key today", "Fhish KMS (k-of-n signers; threshold key is roadmap)", "13-node MPC network", "Threshold network"],
];

export default function Home() {
  return (
    <>
      <Hero />

      <section className="mx-auto mt-6 grid max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Two lines, and the contract you already wrote goes dark.</h2>
          <p className="mt-5 max-w-md text-tide">
            Inherit <code className="font-mono text-biolum">FhishConfig</code> and use encrypted types where you used plain ones. Fhish finds its deployment on its own, at the same registry address on every chain. The API mirrors Zama's fhEVM, so their contracts and ERC-7984 tokens port by changing an import.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-[20px] border border-kelp bg-trench p-6 font-mono text-[13px] leading-relaxed text-foam/90">
          <code>{CODE}</code>
        </pre>
      </section>

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <h2 className="max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">Monad keeps the graph. The coprocessor does the math.</h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-4">
          {[
            ["Your device", "Encrypts the input under the network key and gets a proof that binds it to you and to one contract."],
            ["Monad", "The executor checks who may use each ciphertext, records the operation and emits it. No plaintext, no FHE math, on-chain."],
            ["Coprocessor", "Replays the graph with real tfhe-rs, natively and in parallel: independent operations from different users never wait for each other."],
            ["KMS", "Decrypts only what a contract asked to reveal, signs it k-of-n, and delivers it. Chainlink CRE can carry it on-chain."],
          ].map(([t, b], i) => (
            <li key={t}>
              <span className="font-mono text-sm text-biolum">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-display text-lg font-bold">{t}</h3>
              <p className="mt-2 text-[15px] text-tide">{b}</p>
            </li>
          ))}
        </ol>
        <h3 className="mt-16 font-display text-xl font-bold">Measured, not promised</h3>
        <p className="mt-2 max-w-xl text-sm text-silt">Medians from the Fhish coprocessor on a 10-core laptop running tfhe-rs 1.8.1. The right column updates from a running gateway.</p>
        <div className="mt-6">
          <Metrics />
        </div>
      </section>

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Things that only work in the dark</h2>
        <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {APPS.map((a) => (
            <div key={a.t} className="border-l-2 border-biolum/50 pl-5">
              <h3 className="font-display text-lg font-bold">{a.t}</h3>
              <p className="mt-2 text-tide">{a.b}</p>
            </div>
          ))}
        </div>
        <Link href="/playground" className="mt-10 inline-block rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss hover:brightness-110">Try them in the playground</Link>
      </section>

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <h2 className="max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">Where Fhish stands next to Zama and Fhenix</h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[15px]">
            <thead className="text-sm text-silt">
              <tr className="border-b border-kelp">
                <th className="py-3 pr-4 font-normal" />
                <th className="py-3 pr-4 font-medium text-biolum">Fhish on Monad</th>
                <th className="py-3 pr-4 font-normal">Zama Protocol</th>
                <th className="py-3 font-normal">Fhenix CoFHE</th>
              </tr>
            </thead>
            <tbody>
              {VS.map(([k, a, b, c]) => (
                <tr key={k} className="border-b border-kelp align-top">
                  <td className="py-3 pr-4 text-tide">{k}</td>
                  <td className="py-3 pr-4">{a}</td>
                  <td className="py-3 pr-4 text-tide">{b}</td>
                  <td className="py-3 text-tide">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-2xl text-sm text-silt">Comparison from public docs, October 2026 (docs/research/COMPETITORS.md). Fhish's own trust model today: one KMS operator set holds the key; threshold decryption and ZK input proofs are on the roadmap.</p>
      </section>

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <div className="rounded-[26px] border border-kelp-strong bg-trench p-10 sm:p-14">
          <h2 className="max-w-xl font-display text-3xl font-bold leading-tight sm:text-4xl">Build something nobody can peek at.</h2>
          <p className="mt-4 max-w-lg text-tide">Contracts, the SDK, a native coprocessor, and Claude skills that teach an agent the rules.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/developers" className="rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss hover:brightness-110">Read the developer guide</Link>
            <Link href="/playground" className="rounded-xl border border-kelp-strong px-5 py-3 font-semibold hover:bg-trench-2">Open the playground</Link>
          </div>
        </div>
      </section>
    </>
  );
}
