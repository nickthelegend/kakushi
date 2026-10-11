"use client";
import { useEffect, useState } from "react";

export default function MetricsPage() {
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cre, setCre] = useState<any>(null);
  useEffect(() => {
    const load = () => {
      fetch("/api/gw/metrics")
        .then(async (r) => (r.ok ? setM(await r.json()) : setErr((await r.json()).error)))
        .catch((e) => setErr(String(e)));
      fetch("/api/cre")
        .then(async (r) => setCre(await r.json()))
        .catch(() => setCre(null));
    };
    void load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);
  const names: Record<string, string> = {
    input: "Input attested",
    "op.1": "add",
    "op.2": "sub",
    "op.3": "mul",
    "op.15": "ge",
    "op.16": "gt",
    "op.18": "lt",
    "op.19": "min",
    "op.20": "max",
    select: "select",
    trivial: "encrypt constant",
    "kms.decrypt": "KMS decrypt + sign",
    request_to_callback: "Reveal request to on-chain callback",
    user_decrypt: "User decryption (sealed)",
  };
  return (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Live metrics</h1>
      <p className="mt-3 max-w-2xl text-tide">Straight from the running Kakushi coprocessor (real tfhe-rs). Refreshes every 3 seconds.</p>
      {err && <p className="mt-8 text-reef">{err}</p>}
      {m && (
        <table className="mt-10 w-full text-left">
          <thead className="text-sm text-silt">
            <tr className="border-b border-kelp">
              <th className="py-3 font-normal">Operation</th>
              <th className="py-3 font-normal">Samples</th>
              <th className="py-3 font-normal">p50</th>
              <th className="py-3 font-normal">p95</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(m.latencyMs as Record<string, { n: number; p50: number; p95: number }>).map(([k, v]) => (
              <tr key={k} className="border-b border-kelp">
                <td className="py-3">{names[k] ?? k}</td>
                <td className="py-3 tabular text-tide">{v.n}</td>
                <td className="py-3 tabular text-biolum">{v.p50} ms</td>
                <td className="py-3 tabular text-tide">{v.p95} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="mt-16 font-display text-2xl font-bold">Chainlink CRE delivery</h2>
      <p className="mt-2 max-w-2xl text-tide">
        Reveals reach your contract as CRE reports through the KeystoneForwarder; the oracle re-checks the KMS signatures.
        {cre?.label ? ` Running here: ${cre.label}.` : ""}
      </p>
      {cre && !cre.ok && <p className="mt-4 text-silt">{cre.error}</p>}
      {cre?.ok && (
        <>
          <div className="mt-6 grid grid-cols-3 gap-4">
            {[
              ["Delivered", cre.delivered],
              ["Waiting", cre.pending],
              ["Errors", cre.errors],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl border border-kelp p-4">
                <div className="text-sm text-silt">{k}</div>
                <div className="mt-1 font-display text-2xl tabular text-biolum">{v as number}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 break-all text-sm text-silt">forwarder {cre.forwarder} · oracle {cre.oracle} · block {cre.lastBlock}</p>
          <ul className="mt-4 space-y-1 font-mono text-sm">
            {(cre.last as { requestId: string; tx?: string; ms?: number; error?: string }[]).map((l, i) => (
              <li key={i} className={l.error ? "text-reef" : "text-tide"}>
                request {l.requestId}: {l.error ?? `delivered in ${l.ms} ms · ${l.tx?.slice(0, 18)}…`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
