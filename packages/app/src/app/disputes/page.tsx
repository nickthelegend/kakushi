"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Cpu, Gavel } from "lucide-react";
import { encodeFunctionData, encodeAbiParameters, keccak256, type Hex } from "viem";
import { CHAIN_LIST, CHAINS, chainById } from "@kakushi/config";
import { disputeModuleAbi, findSourcePayments, prepareDispute, srcRefOf, type DisputeReadiness, type SourcePayment } from "@kakushi/sdk";
import { Amount, Button, Card, ChainName, Empty, Notice, Pill, Spinner, ago, short, PageHeader } from "@/components/ui";
import { useRuntime } from "@/lib/runtime";
import { Art } from "@/components/Art";
import { useWallet } from "@/lib/wallet";
import { usePoll } from "@/lib/usePoll";
import { proveInBrowser, type BrowserProof } from "@/lib/prove";
import { receiptLogIndex } from "@/lib/receipt-selection";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

interface Row { logIndex?: number; srcRef: string; maker: string; srcChainId: number; txHash: string; gross: string; token: string; status: string; note: string | null; proofMs: number | null; updatedAt: number }
const SHOW = new Set(["overdue", "proving", "disputed", "slashed", "maker-proven", "unprovable"]);

function DisputeYourself() {
  const { k, cfg } = useRuntime();
  const w = useWallet();
  const sp = useSearchParams();
  const [chainId, setChainId] = useState(Number(sp.get("chain") ?? CHAINS.sepolia.chainId));
  const [tx, setTx] = useState(sp.get("tx") ?? "");
  const [log, setLog] = useState(sp.get("log") ?? "");
  const [payment, setPayment] = useState<SourcePayment | null>(null);
  const [plan, setPlan] = useState<DisputeReadiness | null>(null);
  const [proof, setProof] = useState<BrowserProof | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function check() {
    if (!k || stage) return;
    setErr(null); setPayment(null); setPlan(null); setProof(null); setDone(null);
    setStage("Reading the payment and the CRE windows…");
    try {
      const selectedLog = receiptLogIndex(log);
      if (selectedLog === null) throw new Error("Enter a valid receipt log index.");
      const sources = await findSourcePayments(k, chainId, tx as Hex);
      const p = selectedLog === undefined ? sources[0] : sources.find((x) => x.logIndex === selectedLog);
      if (!p) throw new Error("Not a Kakushi payment to a registered Maker on that chain.");
      const ref = `0x${srcRefOf(p).toString(16).padStart(64, "0")}` as Hex;
      const key = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [ref, p.maker]));
      if ((await k.dispute(key)).settled) throw new Error("This transfer's dispute has already been settled.");
      setPayment(p);
      setPlan(await prepareDispute(k, p));
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]!);
    } finally {
      setStage(null);
    }
  }

  async function prove() {
    if (!plan?.ready || stage) return;
    setErr(null);
    setStage("Starting the proof worker…");
    try {
      const r = await proveInBrowser("payment_compliance", plan.inputs, (s) => setStage(s === "witness" ? "Computing the witness…" : s === "proving" ? "Proving (UltraHonk, in your browser)…" : null));
      setProof(r);
    } catch (e) {
      setErr(`No absence proof: ${(e as Error).message.split("\n")[0]}. If the Maker paid compliantly, the circuit is unsatisfiable, which is the point.`);
    } finally {
      setStage(null);
    }
  }

  async function submit() {
    if (!k || !plan?.ready || !proof || !payment || stage) return;
    setErr(null);
    setStage("Reading the dispute…");
    try {
      const dm = k.d.hub.disputeModule;
      const key = (await k.hub.readContract({ address: dm, abi: disputeModuleAbi, functionName: "disputeKeyOf", args: [`0x${(BigInt(plan.inputs.src_ref as string)).toString(16).padStart(64, "0")}` as Hex, payment.maker] })) as Hex;
      const d = await k.dispute(key);
      if (d.settled) throw new Error("This transfer's dispute has already been settled.");
      const wc = await w.walletClient("monadTestnet");
      if (d.status !== 1) {
        setStage("Opening the dispute (bond)…");
        const h = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: dm, abi: disputeModuleAbi, functionName: "openDispute", args: [BigInt(payment.srcChainId), payment.txHash, payment.logIndex, payment.maker], value: k.bond });
        requireSuccessfulReceipt(await k.hub.waitForTransactionReceipt({ hash: h }), "Dispute bond");
      }
      setStage("Submitting the proof to Monad…");
      const data = encodeFunctionData({ abi: disputeModuleAbi, functionName: "proveDispute", args: [plan.claim as never, plan.payoutWindowIds, proof.proof] });
      // Privy: native gas sponsorship on Monad, so proving needs no MON
      const h = w.sendSponsored ? await w.sendSponsored({ to: dm, data }) : await wc.sendTransaction({ chain: wc.chain, account: wc.account!, to: dm, data });
      const rc = await k.hub.waitForTransactionReceipt({ hash: h });
      if (rc.status !== "success") throw new Error("the proof transaction reverted");
      setDone(h);
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
    } finally {
      setStage(null);
    }
  }

  function clearCheckedTransfer() {
    setPayment(null); setPlan(null); setProof(null); setDone(null); setErr(null);
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2 font-medium"><Cpu className="size-4 text-accent" /> Dispute a transfer yourself</div>
      <p className="text-sm text-muted">Your browser rebuilds the CRE-attested windows from chain data, checks their roots, and proves with Noir that your payment exists and no compliant payout does. Nobody has to trust you, or anyone else.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select aria-label="Source chain" disabled={!!stage} value={chainId} onChange={(e) => { clearCheckedTransfer(); setChainId(Number(e.target.value)); }} className="rounded-full border border-line bg-s2 px-4 py-2.5 text-sm">
          {CHAIN_LIST.map((c) => <option key={c.chainId} value={c.chainId}>{c.shortName}</option>)}
        </select>
        <input aria-label="Source transaction hash" disabled={!!stage} value={tx} onChange={(e) => { clearCheckedTransfer(); setTx(e.target.value.trim()); }} placeholder="0x… your payment transaction" className="flex-1 rounded-full border border-line bg-s2 px-4 py-2.5 font-mono text-sm outline-none" />
        <Button onClick={check} disabled={!k || !!stage || !/^0x[0-9a-fA-F]{64}$/.test(tx)}>Check</Button>
      </div>
      <label className="block text-xs text-muted">Receipt log index (optional for a single payment)<input aria-label="Receipt log index" inputMode="numeric" value={log} disabled={!!stage} onChange={(e) => { clearCheckedTransfer(); setLog(e.target.value); }} className="ml-2 w-28 rounded-xl border border-line bg-s2 px-3 py-2" /></label>
      {stage && <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> {stage}</div>}
      {err && <Notice tone="bad">{err}</Notice>}
      {plan && !plan.ready && <Notice tone="warn">Not disputable yet: {plan.reason}{plan.retryAfterSec ? ` (try again in ~${plan.retryAfterSec} s)` : ""}</Notice>}
      {plan?.ready && payment && (
        <div className="space-y-3 rounded-2xl bg-s2 p-4 text-sm">
          <div>Owed: <Amount value={plan.expected} decimals={payment.token === "0x0000000000000000000000000000000000000000" ? 18 : 6} /> {plan.kind === 1 ? "fill" : "refund"} · deadline passed · {plan.payoutWindowIds.length} attested window(s) cover it</div>
          {!proof ? (
            <Button variant="indigo" onClick={prove} loading={!!stage}>Generate the proof in your browser</Button>
          ) : (
            <div className="space-y-2">
              <Notice tone="ok">Proof ready: {proof.publicInputs.length} public inputs, {(proof.proof.length - 2) / 2} bytes, {proof.ms} ms.</Notice>
              {!w.address ? <Notice>Connect a wallet to submit.</Notice> : <Button onClick={submit} loading={!!stage}><Gavel className="size-4" /> Open the dispute and prove it on Monad</Button>}
              {w.sendSponsored && <div className="text-xs text-muted">Gas for the proof is sponsored by Privy.</div>}
            </div>
          )}
        </div>
      )}
      {done && <Notice tone="ok">Slashed. The Maker's margin was sent to {short(payment!.sender)} on Monad. <Link className="underline" href={`/tx/${chainId}/${tx}?log=${payment!.logIndex}`}>View the transfer</Link></Notice>}
      {cfg?.network === "local" && <p className="text-xs text-dim">Local forks: the bond is paid in local MON.</p>}
    </Card>
  );
}

export default function DisputesPage() {
  const { cfg } = useRuntime();
  const load = useCallback(async () => {
    const r = await fetch("/api/svc/watchtower/watched");
    if (!r.ok) throw new Error((await r.json()).error ?? "watchtower unavailable");
    return ((await r.json()) as Row[]).filter((x) => SHOW.has(x.status));
  }, []);
  const watchtowerConfigured = Boolean(cfg?.services.watchtower);
  const { data, error, loading } = usePoll(watchtowerConfigured ? load : null, 4000, [cfg]);
  return (
    <div className="space-y-8">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_260px]">
        <PageHeader title="Disputes" subtitle="When a Maker misses a deadline, anyone can prove it. The Watchtower does it automatically and posts the bond; you can also do it yourself, in your browser." />
        <Art src="/art/seal.webp" alt="" className="hidden aspect-square w-full rounded-[16px] object-cover md:block" />
      </div>
      <Suspense fallback={<Card className="flex items-center gap-3"><Spinner /> Loading…</Card>}>
        <DisputeYourself />
      </Suspense>
      <div>
        <div className="mb-3 font-medium">Watchtower cases</div>
        {cfg && !watchtowerConfigured && <Notice tone="warn">Watchtower cases are unavailable: no Watchtower is configured.</Notice>}
        {error && <Notice tone="warn">Watchtower: {error}</Notice>}
        {loading && !data && <Card className="flex items-center gap-3"><Spinner /> Loading Watchtower cases…</Card>}
        {data && data.length === 0 && <Empty title="No disputes">No overdue cases reported by this Watchtower.</Empty>}
        <div className="space-y-2">
          {data?.map((r) => {
            const native = r.token === "0x0000000000000000000000000000000000000000";
            const maker = cfg?.makers.find((m) => m.address.toLowerCase() === r.maker)?.name ?? short(r.maker);
            return (
              <Link key={r.srcRef + r.maker} href={`/tx/${r.srcChainId}/${r.txHash}${r.logIndex === undefined ? "" : `?log=${r.logIndex}`}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-s1 px-5 py-4 hover:bg-s2">
                <span className="flex items-center gap-3"><ChainName chainId={r.srcChainId} /> <Amount value={BigInt(r.gross)} decimals={native ? 18 : 6} symbol={native ? "ETH" : "USDC"} max={4} /> <span className="text-muted">to {maker}</span></span>
                <span className="flex items-center gap-3 text-sm text-muted">
                  {r.proofMs && <span>proof {r.proofMs} ms</span>}
                  <span>{ago(Math.floor(r.updatedAt / 1000))}</span>
                  <Pill tone={r.status === "slashed" ? "indigo" : r.status === "maker-proven" || r.status === "unprovable" ? "ok" : "warn"}>{r.status === "slashed" ? "slashed → sender" : r.status}</Pill>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-dim">{chainById(10143).shortName} hub · bond {cfg?.deployments?.hub ? (Number(cfg.deployments.hub.bond) / 1e18).toString() : "…"} MON · dispute window {cfg?.deployments?.hub?.disputeWindow ?? "…"} s</p>
    </div>
  );
}
