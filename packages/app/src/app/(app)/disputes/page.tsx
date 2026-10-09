"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Cpu, Gavel, Search, ShieldCheck } from "lucide-react";
import { DataTable, PanelCard, PrimaryButton, SecondaryButton } from "@kakushi/ui";
import { encodeFunctionData, encodeAbiParameters, keccak256, type Hex } from "viem";
import { CHAIN_LIST, CHAINS, chainById } from "@kakushi/config";
import { disputeModuleAbi, findSourcePayments, prepareDispute, srcRefOf, type DisputeReadiness, type SourcePayment } from "@kakushi/sdk";
import { Amount, ChainName, Loading, Notice, PageHead, Pill, Spinner, ago, fieldCls, readError, short , ArtBanner } from "@/components/kit";
import { useRouter } from "next/navigation";
import { useRuntime } from "@/lib/runtime";
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
    <PanelCard title="Prove it yourself" subtitle="In your browser, with Noir" badge={<Pill tone="indigo">UltraHonk</Pill>}>
      <p className="max-w-[70ch] text-[15px] leading-[1.5] text-ui-muted">Your browser rebuilds the CRE-attested windows from chain data, checks their roots, and proves that your payment exists and no compliant payout does. Nobody has to trust you, or anyone else.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_110px_auto]">
        <select aria-label="Source chain" disabled={!!stage} value={chainId} onChange={(e) => { clearCheckedTransfer(); setChainId(Number(e.target.value)); }} className={fieldCls}>
          {CHAIN_LIST.map((c) => <option key={c.chainId} value={c.chainId}>{c.shortName}</option>)}
        </select>
        <input aria-label="Source transaction hash" disabled={!!stage} value={tx} onChange={(e) => { clearCheckedTransfer(); setTx(e.target.value.trim()); }} placeholder="0x… your payment transaction" className={`${fieldCls} font-mono text-[14px]`} />
        <input aria-label="Receipt log index (optional)" placeholder="Log index" inputMode="numeric" value={log} disabled={!!stage} onChange={(e) => { clearCheckedTransfer(); setLog(e.target.value); }} className={fieldCls} />
        <PrimaryButton size="lg" icon={<Search />} onClick={check} disabled={!k || !!stage || !/^0x[0-9a-fA-F]{64}$/.test(tx)}>Check</PrimaryButton>
      </div>
      <p className="mt-2 px-1 text-[13px] text-ui-muted">The log index is only needed when one transaction carries several payments.</p>
      {!k && <Notice tone="warn" className="mt-4 mb-0">The hub is not reachable from this deployment, so transfers can't be checked yet.</Notice>}
      {stage && <div className="mt-4 flex items-center gap-2 text-[14px] text-ui-muted"><Spinner /> {stage}</div>}
      {err && <Notice tone="bad" className="mt-4 mb-0">{err}</Notice>}
      {plan && !plan.ready && <Notice tone="warn" className="mt-4 mb-0">Not disputable yet: {plan.reason}{plan.retryAfterSec ? ` (try again in about ${plan.retryAfterSec} s)` : ""}</Notice>}
      {plan?.ready && payment && (
        <div className="mt-4 grid gap-4 rounded-[24px] bg-ui-canvas p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><div className="text-[13px] text-ui-muted">Owed</div><div className="mt-0.5 text-[20px] font-medium"><Amount value={plan.expected} decimals={payment.token === "0x0000000000000000000000000000000000000000" ? 18 : 6} /></div></div>
            <div><div className="text-[13px] text-ui-muted">Obligation</div><div className="mt-0.5 text-[20px] font-medium">{plan.kind === 1 ? "Fill" : "Refund"}</div></div>
            <div><div className="text-[13px] text-ui-muted">Attested windows</div><div className="ui-figure mt-0.5 text-[20px] font-medium">{plan.payoutWindowIds.length}</div></div>
          </div>
          {!proof ? (
            <PrimaryButton size="lg" icon={<Cpu />} onClick={prove} loading={!!stage} className="justify-self-start">Generate the proof in your browser</PrimaryButton>
          ) : (
            <div className="grid gap-3">
              <Notice tone="ok" className="mb-0">Proof ready: {proof.publicInputs.length} public inputs, {(proof.proof.length - 2) / 2} bytes, {proof.ms} ms.</Notice>
              {!w.address ? <Notice className="mb-0">Connect a wallet to submit.</Notice> : <PrimaryButton size="lg" icon={<Gavel />} onClick={submit} loading={!!stage} className="justify-self-start">Open the dispute and prove it on Monad</PrimaryButton>}
              {w.sendSponsored && <p className="text-[13px] text-ui-muted">Gas for the proof is sponsored by Privy.</p>}
            </div>
          )}
        </div>
      )}
      {done && <Notice tone="ok" className="mt-4 mb-0">Slashed. The Maker&rsquo;s margin was sent to {short(payment!.sender)} on Monad. <Link className="underline" href={`/tx/${chainId}/${tx}?log=${payment!.logIndex}`}>View the transfer</Link></Notice>}
      {cfg?.network === "local" && <p className="mt-4 text-[13px] text-ui-muted">Local forks: the bond is paid in local MON.</p>}
    </PanelCard>
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
  const router = useRouter();
  const hub = cfg?.deployments?.hub;
  return (
    <div>
      <ArtBanner src="/art/seal.webp" position="50% 30%" />
      <PageHead
        title="Disputes"
        sub="When a Maker misses a deadline, anyone can prove it. The Watchtower does it automatically and posts the bond; you can also do it yourself, in your browser."
        right={hub ? <Pill tone="indigo">{`Bond ${Number(hub.bond) / 1e18} MON · window ${hub.disputeWindow} s`}</Pill> : undefined}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Suspense fallback={<Loading>Loading…</Loading>}>
          <DisputeYourself />
        </Suspense>
        <PanelCard title="Watchtower cases" subtitle="Overdue transfers and their proofs" badge={<ShieldCheck className="size-5 text-ui-muted" />}>
          {cfg && !watchtowerConfigured && <Notice tone="warn" className="mb-0">Watchtower cases are unavailable: no Watchtower is configured for this deployment.</Notice>}
          {error && <Notice tone="warn" className="mb-0" title="The Watchtower isn't reachable">{readError(error)}</Notice>}
          {watchtowerConfigured && !(error && !data) && (
            <DataTable
              caption="Watchtower cases"
              loading={loading && !data}
              loadingRows={4}
              rows={data ?? []}
              rowKey={(r) => r.srcRef + r.maker}
              onRowClick={(r) => router.push(`/tx/${r.srcChainId}/${r.txHash}${r.logIndex === undefined ? "" : `?log=${r.logIndex}`}`)}
              empty={<p className="py-10 text-center text-[15px] text-ui-muted">No overdue transfers. Every Maker has paid on time.</p>}
              columns={[
                { key: "amount", header: "Transfer", render: (r) => { const native = r.token === "0x0000000000000000000000000000000000000000"; return <span className="grid gap-0.5"><Amount value={BigInt(r.gross)} decimals={native ? 18 : 6} symbol={native ? "ETH" : "USDC"} max={4} /><span className="text-[13px] text-ui-muted"><ChainName chainId={r.srcChainId} size={14} /></span></span>; } },
                { key: "maker", header: "Maker", hideBelow: "sm", render: (r) => cfg?.makers.find((m) => m.address.toLowerCase() === r.maker)?.name ?? short(r.maker) },
                { key: "status", header: "Status", render: (r) => <Pill tone={r.status === "slashed" ? "indigo" : r.status === "maker-proven" ? "ok" : r.status === "overdue" ? "bad" : "warn"}>{r.status === "slashed" ? "Paid from margin" : r.status === "maker-proven" ? "Maker proved payout" : r.status === "unprovable" ? "Proof unavailable" : r.status[0]!.toUpperCase() + r.status.slice(1)}</Pill> },
                { key: "when", header: "Updated", align: "right", hideBelow: "md", render: (r) => <span className="text-ui-muted">{r.proofMs ? `proof ${r.proofMs} ms · ` : ""}{ago(Math.floor(r.updatedAt / 1000))}</span> },
              ]}
            />
          )}
          {!cfg && <Loading>Loading…</Loading>}
          <SecondaryButton asChild size="sm" className="mt-4"><Link href="/attestations">See the attested windows</Link></SecondaryButton>
        </PanelCard>
      </div>
      <p className="mt-6 text-[13px] text-ui-muted">{chainById(10143).shortName} hub. A slash pays the sender the full amount from the Maker&rsquo;s margin; the challenger&rsquo;s bond comes back with a reward.</p>
    </div>
  );
}
