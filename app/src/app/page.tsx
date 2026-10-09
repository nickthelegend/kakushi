"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Shoal } from "@/components/Shoal";
import { Heartbeat } from "@/components/pay/Heartbeat";
import { encryptInBrowser } from "@/lib/encrypt";
import { usePay } from "@/lib/pay/wallet";

function Hero() {
  const [value, setValue] = useState("3,200.00");
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [state, setState] = useState<{ phase: "idle" | "loading" | "done" | "error"; msg?: string; ms?: number; size?: number; threads?: boolean }>({ phase: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | undefined>();

  async function go() {
    const [whole, frac = ""] = value.replace(/[^\d.]/g, "").split(".");
    const units = BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
    setState({ phase: "loading", msg: "Loading the tfhe WASM and the network key…" });
    try {
      const r = await encryptInBrowser(4, units);
      const rect = box.current?.getBoundingClientRect();
      setOrigin(rect ? { x: rect.width * 0.22, y: rect.height * 0.7 } : undefined);
      setBytes(r.bytes);
      setState({ phase: "done", ms: r.ms, size: r.bytes.length, threads: r.threads });
    } catch (e) {
      setState({ phase: "error", msg: (e as Error).message });
    }
  }

  return (
    <section ref={box} className="relative isolate overflow-hidden">
      <Shoal bytes={bytes} origin={origin} className="absolute inset-0 -z-10 h-full w-full" />
      <div className="mx-auto max-w-6xl px-5 pt-14 pb-24 sm:pt-20">
        <p className="font-mono text-sm text-biolum">Fhish Pay · confidential payments infrastructure for Monad</p>
        <h1 className="mt-4 max-w-4xl font-display text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.96] tracking-[-0.03em]">Pay anyone. Show no one.</h1>
        <p className="mt-7 max-w-2xl text-lg text-tide">
          Real stablecoins, Agora AUSD and Circle USDC, with every amount and every balance encrypted end to end. Run payroll, send money by link, keep your balance to yourself, and settle with Monad finality in well under a second.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/pay" className="rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss hover:brightness-110">Open Fhish Pay</Link>
          <Link href="/pay/employer" className="rounded-xl border border-kelp-strong px-5 py-3 font-semibold hover:bg-trench-2">Run a private payroll</Link>
        </div>
        <form
          className="mt-12 max-w-xl rounded-[22px] border border-kelp-strong bg-trench/80 p-5 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <label htmlFor="secret" className="text-sm text-tide">Type a salary. It is encrypted right here, in your browser.</label>
          <div className="mt-2 flex gap-3">
            <div className="relative min-w-0 flex-1">
              <input id="secret" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, "").slice(0, 16))} className="w-full rounded-xl border border-kelp bg-abyss py-2 pr-16 pl-4 font-display text-2xl font-bold tabular outline-none focus:border-biolum" />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-silt">AUSD</span>
            </div>
            <button disabled={state.phase === "loading"} className="rounded-xl bg-biolum px-5 font-semibold text-abyss hover:brightness-110 disabled:opacity-60">
              {state.phase === "loading" ? "Encrypting…" : "Encrypt"}
            </button>
          </div>
          <p className="mt-3 min-h-12 text-sm text-tide" aria-live="polite">
            {state.phase === "idle" && "Zama's tfhe-rs, compiled to WASM, encrypts it under the Fhish network key. Nothing is sent anywhere."}
            {state.phase === "loading" && state.msg}
            {state.phase === "done" && (
              <>
                <span className="text-foam">{value} AUSD</span> became <span className="text-biolum tabular">{state.size!.toLocaleString()} bytes</span> of ciphertext in {state.ms} ms{state.threads ? ", multi-threaded" : ""}. The bytes swimming behind this box are that ciphertext. This is all the chain, the explorer or a colleague would ever see of it.
              </>
            )}
            {state.phase === "error" && <span className="text-reef">{state.msg}</span>}
          </p>
        </form>
      </div>
    </section>
  );
}

function TwoViews() {
  return (
    <section className="mx-auto mt-10 max-w-6xl px-5">
      <h2 className="max-w-3xl font-display text-3xl font-bold leading-tight sm:text-4xl">Public rails. Private amounts.</h2>
      <p className="mt-4 max-w-2xl text-tide">Who paid whom, and when, stays on a public chain you can audit. How much never does. The same payroll, seen from two seats:</p>
      <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        <figure className="rounded-[22px] border border-kelp bg-trench/70 p-6">
          <figcaption className="text-xs uppercase tracking-wider text-silt">Block explorer, competitor, colleague</figcaption>
          <ul className="mt-4 space-y-3 font-mono text-sm">
            {[
              ["Paid", "0x7099…79C8", "0x3C44…93BC", "0x9f3c41a7…5be1e2"],
              ["Paid", "0x7099…79C8", "0x90F7…b906", "0x2b08d1c4…0a91f7"],
              ["PayrollRun", "0x7099…79C8", "2 employees", "payroll 2026-10"],
            ].map(([e, a, b, c]) => (
              <li key={b} className="grid grid-cols-[auto_1fr] gap-x-3 text-tide">
                <span className="text-foam">{e}</span>
                <span className="truncate">
                  {a} → {b}
                </span>
                <span />
                <span className="truncate text-biolum/80">{c}</span>
              </li>
            ))}
          </ul>
        </figure>
        <figure className="rounded-[22px] border border-lantern/30 bg-trench/70 p-6">
          <figcaption className="text-xs uppercase tracking-wider text-silt">The employee, after one signature</figcaption>
          <p className="mt-4 text-sm text-tide">Salary from 0x7099…79C8 · payroll 2026-10</p>
          <p className="mt-2 font-display text-4xl font-extrabold">
            <span className="rounded-lg bg-lantern-soft px-2 text-lantern tabular">3,200.00</span> <span className="text-xl text-tide">AUSD</span>
          </p>
          <p className="mt-4 text-sm text-silt">Decrypted for this person only: the gateway checks the on-chain ACL and seals the value to a key that exists only in their tab. Their colleague's salary stays a ciphertext, even to them.</p>
        </figure>
      </div>
      <p className="mt-3 text-xs text-silt">Illustration. The live version is one click away in Fhish Pay.</p>
    </section>
  );
}

const PRODUCTS = [
  { t: "Private payroll", b: "Pay the whole team in one transaction. Each salary is a separate ciphertext only the employer and that employee can read. Hand the run to a policy-fenced Privy server wallet and payroll goes out on schedule while you are offline.", href: "/pay/employer", cta: "Open Fhish Payroll" },
  { t: "Pay links", b: "Send money to someone who has no wallet yet: the amount is escrowed encrypted behind a one-time key that lives only in the link. They sign in with an email, claim it without buying gas, and only they see how much.", href: "/pay", cta: "Create a pay link" },
  { t: "Private balances", b: "Wrap AUSD into cAUSD and your balance becomes yours alone. Pay with a public reference for your books, reveal your own numbers with one signature, cash out whenever you like; only the cash-out amount is ever decrypted.", href: "/pay", cta: "See your balance" },
];

function Privy() {
  const pay = usePay();
  const items = [
    ["Email and passkey sign-in", "An embedded wallet on Monad is created at login. No seed phrase, no extension."],
    ["Native gas sponsorship", "Every payment is sent with sponsor: true (EIP-7702 + paymaster on Monad testnet). Users never hold MON."],
    ["Server wallet + policy", "The payroll operator is a Privy server wallet. A Privy policy lets it call only runPayrollFrom on cAUSD, only on chain 10143, only until a date."],
    ["Typed-data signing", "Reading your own balance is one EIP-712 signature from the embedded wallet, so private reads need no extra keys."],
  ];
  return (
    <section className="mx-auto mt-32 max-w-6xl px-5">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Sign in with an email. Gas is on us.</h2>
          <p className="mt-4 max-w-md text-tide">Fhish Pay runs on Privy for far more than login: wallets, sponsored gas and a policy-bound payroll robot.</p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-kelp-strong px-3 py-1 text-xs text-tide">
            <span className={`size-1.5 rounded-full ${pay.mode === "privy" ? "bg-sea-green" : "bg-lantern"}`} aria-hidden />
            {pay.mode === "privy" ? "Privy is live on this deployment" : "This deployment runs in local-fork mode (Privy not configured)"}
          </p>
        </div>
        <dl className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
          {items.map(([t, b]) => (
            <div key={t} className="border-l-2 border-biolum/50 pl-4">
              <dt className="font-display text-base font-bold">{t}</dt>
              <dd className="mt-1.5 text-[15px] text-tide">{b}</dd>
            </div>
          ))}
        </dl>
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
    { what: "Encrypt an amount (your device)", v: "6 to 30 ms native · see above for your browser", live: p("input") && `attestation ${p("input")}` },
    { what: "Encrypted add, euint64", v: "174 ms", live: p("op.1") },
    { what: "Encrypted compare (gt)", v: "103 ms", live: p("op.16") },
    { what: "Encrypted select", v: "158 ms", live: p("select") },
    { what: "KMS decrypt and sign", v: "~0.5 s", live: p("kms.decrypt") },
    { what: "Cash-out request to AUSD released", v: "~2 to 5 s on 1 s local blocks", live: p("request_to_callback") },
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

contract Payroll is FhishConfig {               // line 1
    mapping(address => euint64) balance;

    function pay(address to, externalEuint64 enc, bytes calldata proof) external {
        euint64 amt = FHE.fromExternal(enc, proof); // line 2
        balance[msg.sender] = FHE.sub(balance[msg.sender], amt); // on ciphertext
        balance[to] = FHE.add(balance[to], amt);
        FHE.allow(balance[to], to);              // only they can read it
    }
}`;

const ALSO = [
  { t: "Sealed-bid auction", b: "Every bid stays encrypted. The contract keeps an encrypted running maximum; only the winner and price are ever revealed." },
  { t: "Dark OTC desk", b: "Makers post encrypted limit prices. A taker learns only whether they crossed. A miss reveals nothing, so there is nothing to front-run." },
  { t: "Confidential USDC", b: "Wrap any ERC-20, including Monad USDC, and its balances and transfers become encrypted." },
  { t: "Private voting", b: "Ballots are encrypted booleans added into encrypted tallies. Only the result is ever revealed." },
];

const VS: [string, string, string, string][] = [
  ["Reveal a value", "Automatic: the KMS calls your contract back", "Two transactions plus an off-chain fetch", "Request, then fetch"],
  ["Solidity API", "fhEVM-shaped FHE.sol: ports with an import change", "FHE.sol (changes between versions)", "FHE.sol, own SDK"],
  ["Make an existing token confidential", "Wrap any ERC-20 (AUSD, USDC) as-is", "Rewrite against their stack", "Rewrite against their stack"],
  ["Where it runs", "Monad: sub-second finality, measured live on this page", "Ethereum mainnet", "Testnets (Ethereum, Arbitrum, Base)"],
  ["Published latency", "Yes, live p50/p95 on this site", "Not published", "Research benchmarks"],
  ["Who holds the decryption key today", "Fhish KMS (k-of-n signers; threshold key is roadmap)", "13-node MPC network", "Threshold network"],
];

export default function Home() {
  return (
    <>
      <Hero />
      <TwoViews />

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <h2 className="max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">Three ways to move money quietly</h2>
        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PRODUCTS.map((p) => (
            <article key={p.t} className="flex flex-col rounded-[22px] border border-kelp bg-trench/60 p-6">
              <h3 className="font-display text-lg font-bold">{p.t}</h3>
              <p className="mt-3 flex-1 text-[15px] text-tide">{p.b}</p>
              <Link href={p.href} className="mt-6 text-sm font-semibold text-biolum hover:underline">
                {p.cta} →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-32 grid grid-cols-1 max-w-6xl gap-10 px-5 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Settled before you look up.</h2>
          <p className="mt-4 max-w-md text-tide">
            Monad blocks move from Proposed to Voted to Finalized in well under a second. Fhish Pay shows that ladder, with real timings, after every payment, and waits for finality before the KMS will reveal anything. The table is live Monad testnet, straight from its monadNewHeads stream.
          </p>
        </div>
        <Heartbeat rows={7} />
      </section>

      <Privy />

      <section className="mx-auto mt-32 grid grid-cols-1 max-w-6xl gap-12 px-5 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div>
          <p className="font-mono text-sm text-biolum">For developers</p>
          <h2 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">Two lines, and the payments contract you already wrote goes dark.</h2>
          <p className="mt-5 max-w-md text-tide">
            Fhish Pay is one contract on top of Fhish, the encrypted-computation layer for Monad. Inherit <code className="font-mono text-biolum">FhishConfig</code> and use encrypted types where you used plain ones. The API mirrors Zama's fhEVM, so their contracts and ERC-7984 tokens port by changing an import.
          </p>
          <Link href="/developers" className="mt-6 inline-block text-sm font-semibold text-biolum hover:underline">Read the developer guide →</Link>
        </div>
        <pre className="overflow-x-auto rounded-[20px] border border-kelp bg-trench p-6 font-mono text-[13px] leading-relaxed text-foam/90">
          <code>{CODE}</code>
        </pre>
      </section>

      <section className="mx-auto mt-32 max-w-6xl px-5">
        <h2 className="max-w-2xl font-display text-3xl font-bold leading-tight sm:text-4xl">Monad keeps the graph. The coprocessor does the math.</h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-4">
          {[
            ["Your device", "Encrypts the amount under the network key and gets a proof that binds it to you and to one contract."],
            ["Monad", "The executor checks who may use each ciphertext, records the operation and emits it. No plaintext, no FHE math, on-chain."],
            ["Coprocessor", "Replays the graph with real tfhe-rs, natively and in parallel: payments from different people never wait for each other."],
            ["KMS", "Decrypts only what you ask to read or cash out, signs it k-of-n, and delivers it. Chainlink CRE can carry it on-chain."],
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
        <h2 className="font-display text-3xl font-bold sm:text-4xl">Also built on Fhish</h2>
        <p className="mt-3 max-w-xl text-tide">The same encrypted types power more than payments.</p>
        <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {ALSO.map((a) => (
            <div key={a.t} className="border-l-2 border-biolum/50 pl-5">
              <h3 className="font-display text-lg font-bold">{a.t}</h3>
              <p className="mt-2 text-tide">{a.b}</p>
            </div>
          ))}
        </div>
        <Link href="/playground" className="mt-10 inline-block rounded-xl border border-kelp-strong px-5 py-3 font-semibold hover:bg-trench-2">Try them in the playground</Link>
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
        <div className="rounded-[26px] border border-kelp-strong bg-trench p-8 sm:p-14">
          <h2 className="max-w-xl font-display text-3xl font-bold leading-tight sm:text-4xl">Money that minds its own business.</h2>
          <p className="mt-4 max-w-lg text-tide">Real AUSD, encrypted end to end, final on Monad in under a second.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/pay" className="rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss hover:brightness-110">Open Fhish Pay</Link>
            <Link href="/pay/employer" className="rounded-xl border border-kelp-strong px-5 py-3 font-semibold hover:bg-trench-2">Run payroll</Link>
            <Link href="/developers" className="rounded-xl border border-kelp-strong px-5 py-3 font-semibold hover:bg-trench-2">Build on Fhish</Link>
          </div>
        </div>
      </section>
    </>
  );
}
