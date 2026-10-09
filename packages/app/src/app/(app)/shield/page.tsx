"use client";

import { CopyButton, PrimaryButton, cn } from "@kakushi/ui";
import { Download, Lock, Shield, Unlock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, zeroAddress, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { IncrementalMerkleTree, fieldToHex, generateNote, noteCommitment, noteNullifierHash, parseNote, serializeNote, type Note } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { readError, short } from "@/components/kit";
import { ChainSelect, Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { erc20ApproveAbi, poolAbi, usePrivacyChains } from "@/lib/privacy";
import { proveInBrowser } from "@/lib/prove";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

const hx = (x: bigint) => `0x${x.toString(16)}`;

function Deposit() {
  const { k } = useRuntime();
  const w = useWallet();
  const { chains } = usePrivacyChains();
  const [chainId, setChainId] = useState(10143);
  const pc = chains.find((c) => c.chain.chainId === chainId) ?? chains[0]!;
  const pools = Object.entries(pc.privacy.pools);
  const [label, setLabel] = useState(pools[0]?.[0] ?? "");
  const pool = pc.privacy.pools[label] ?? pools[0]?.[1];
  const [note, setNote] = useState<Note | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Hex | null>(null);
  useEffect(() => {
    setLabel(Object.keys(pc.privacy.pools)[0] ?? "");
    setNote(null);
    setSaved(false);
  }, [pc]);

  function download(n: Note) {
    const blob = new Blob([serializeNote(n)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kakushi-note-${pc.chain.shortName.replace(/\s/g, "")}-${label}.txt`;
    a.click();
    setSaved(true);
  }

  async function deposit() {
    if (!pool || !note || !saved || busy) return;
    setErr(null);
    try {
      const wc = await w.walletClient(pc.chain.key);
      const client = k!.client(pc.chain.key);
      const amount = BigInt(pool.denomination);
      const native = pool.token === zeroAddress;
      if (!native) {
        const allowance = (await client.readContract({ address: pool.token, abi: erc20ApproveAbi, functionName: "allowance", args: [w.address as Hex, pool.address] })) as bigint;
        if (allowance < amount) {
          setBusy("Approve in your wallet…");
          const ah = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pool.token, abi: erc20ApproveAbi, functionName: "approve", args: [pool.address, amount] });
          requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash: ah }), "Approval");
        }
      }
      setBusy("Confirm the deposit…");
      const hash = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pool.address, abi: poolAbi, functionName: "deposit", args: [fieldToHex(noteCommitment(note))], value: native ? amount : 0n });
      setBusy("Depositing…");
      requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), "Deposit");
      setDone(hash);
      setNote(null);
      setSaved(false);
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Well>
        <div className="flex items-center justify-between text-[13px] text-ui-muted">
          <span>Amount</span>
          <ChainSelect chains={chains} value={pc.chain.chainId} onChange={setChainId} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {pools.map(([l, p]) => (
            <button key={l} type="button" onClick={() => { setLabel(l); setNote(null); setSaved(false); }} className={cn("rounded-full px-4 py-2 text-[15px] font-medium ring-1 transition-colors", l === label ? "bg-[#16205a] text-white ring-[#3b55ff]/60" : "bg-ui-surface-2 text-ui-muted ring-transparent hover:text-ui-text")}>
              {formatUnits(BigInt(p.denomination), p.decimals)} {p.symbol}
            </button>
          ))}
        </div>
      </Well>
      {note ? (
        <Well className="mt-2">
          <div className="text-[13px] text-ui-muted">Your note: the only way to withdraw</div>
          <div className="mt-2 break-all font-mono text-[12px] text-[#c4d0ff]">{serializeNote(note).slice(0, 44)}…</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => download(note)} className="inline-flex items-center gap-1.5 rounded-full bg-ui-surface-2 px-4 py-2 text-[14px] font-medium hover:bg-ui-surface-3">
              <Download size={15} /> {saved ? "Saved. Download again" : "Download note"}
            </button>
            <span onClickCapture={() => setSaved(true)}>
              <CopyButton value={serializeNote(note)} label="note" variant="button" />
            </span>
          </div>
        </Well>
      ) : null}
      <div className="mt-3">
        {!w.address ? (
          <ConnectButton block large />
        ) : !note ? (
          <PrimaryButton size="lg" block className="h-[58px] text-[17px]" icon={<Lock />} disabled={!pool} onClick={() => { setDone(null); setNote(generateNote(pc.chain.chainId, pool!.address)); }}>
            Shield {pool ? `${formatUnits(BigInt(pool.denomination), pool.decimals)} ${pool.symbol}` : ""}
          </PrimaryButton>
        ) : (
          <PrimaryButton size="lg" block className="h-[58px] text-[17px]" icon={<Lock />} disabled={!saved || !!busy} loading={!!busy} onClick={deposit}>
            {busy ?? (saved ? "Deposit" : "Save your note first")}
          </PrimaryButton>
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline={`Shielded ${pool ? formatUnits(BigInt(pool.denomination), pool.decimals) + " " + pool.symbol : ""}`} sub="Withdraw any time with your note" details={<span>Tx {short(done, 6)}</span>} /> : null}
    </>
  );
}

function Withdraw() {
  const { k, cfg } = useRuntime();
  const w = useWallet();
  const { chains } = usePrivacyChains();
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
  const [relayer, setRelayer] = useState<{ address: Hex; feeByPool: Record<string, Record<string, string>> } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; ms: number } | null>(null);
  useEffect(() => {
    if (!cfg?.services.relayer) return;
    fetch("/api/svc/relayer/info").then((r) => (r.ok ? r.json() : null)).then(setRelayer).catch(() => setRelayer(null));
  }, [cfg]);

  const note = useMemo(() => {
    try {
      return text.trim() ? parseNote(text.trim()) : null;
    } catch {
      return null;
    }
  }, [text]);
  const pc = note ? chains.find((c) => c.chain.chainId === note.chainId) : null;
  const pool = pc && note ? Object.values(pc.privacy.pools).find((p) => p.address.toLowerCase() === note.pool.toLowerCase()) : null;
  const relayFee = relayer && note ? BigInt(relayer.feeByPool[String(note.chainId)]?.[note.pool.toLowerCase()] ?? relayer.feeByPool[String(note.chainId)]?.[note.pool] ?? "-1") : -1n;
  const viaRelayer = useRelayer && relayer && relayFee >= 0n;

  async function withdraw() {
    if (!note || !pc || !pool || !isAddress(recipient) || stage) return;
    setErr(null);
    setDone(null);
    try {
      setStage("Reading the pool…");
      const client = k!.client(pc.chain.key);
      const tree = await IncrementalMerkleTree.fromDeposits(client, pool.address, BigInt(pc.privacy.deployBlock));
      const path = tree.pathForNote(note);
      const relayerAddr = viaRelayer ? relayer!.address : (zeroAddress as Hex);
      const fee = viaRelayer ? relayFee : 0n;
      const nullifierHash = noteNullifierHash(note);
      const inputs = {
        root: hx(path.root), nullifier_hash: hx(nullifierHash), recipient: hx(BigInt(recipient)), relayer: hx(BigInt(relayerAddr)),
        fee: hx(fee), refund: "0x0", chain_id: hx(BigInt(pc.chain.chainId)), pool: hx(BigInt(pool.address)),
        nullifier: hx(note.nullifier), secret: hx(note.secret), path: path.pathElements.map(hx), path_bits: path.pathIndices,
      };
      setStage("Proving in your browser…");
      const proof = await proveInBrowser("shielded_withdraw", inputs, (s) => setStage(s === "witness" ? "Computing the witness…" : "Proving in your browser…"));
      const args = { root: fieldToHex(path.root), nullifierHash: fieldToHex(nullifierHash), recipient: recipient as Hex, relayer: relayerAddr, fee: fee.toString(), refund: "0" };
      let hash: Hex;
      if (viaRelayer) {
        setStage("Relaying…");
        const r = await fetch("/api/svc/relayer/relay", { method: "POST", body: JSON.stringify({ chainId: pc.chain.chainId, pool: pool.address, proof: proof.proof, args }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The relayer refused the withdrawal");
        hash = j.txHash;
      } else {
        setStage("Confirm in your wallet…");
        const wc = await w.walletClient(pc.chain.key);
        hash = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pool.address, abi: poolAbi, functionName: "withdraw", args: [proof.proof, args.root, args.nullifierHash, recipient as Hex, relayerAddr, 0n, 0n] });
      }
      setStage("Withdrawing…");
      requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), "Withdrawal");
      setDone({ hash, ms: proof.ms });
    } catch (e) {
      setErr(readError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message) ?? "Withdrawal failed");
    } finally {
      setStage(null);
    }
  }

  return (
    <>
      <Well>
        <div className="text-[13px] text-ui-muted">Note</div>
        <textarea aria-label="Your note" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="kakushi-note-v1-…" className={cn(inputCls, "mt-2 resize-none font-mono text-[13px]")} />
        {text && !note ? <p className="mt-1 text-[13px] text-ui-warn">Not a Kakushi note</p> : null}
        {note && !pool ? <p className="mt-1 text-[13px] text-ui-warn">This note&rsquo;s pool isn&rsquo;t on this network</p> : null}
        {pool ? <p className="mt-1 text-[13px] text-[#c4d0ff]">{formatUnits(BigInt(pool.denomination), pool.decimals)} {pool.symbol} on {chainById(note!.chainId).shortName}</p> : null}
      </Well>
      <Well className="mt-2">
        <div className="text-[13px] text-ui-muted">To</div>
        <input aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x… a fresh wallet" className={cn(inputCls, "mt-2 font-mono text-[14px]")} />
        {relayer ? (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ui-muted">
            <input type="checkbox" checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} className="accent-[#2f47f5]" />
            Gasless via relayer{relayFee >= 0n && pool ? ` · fee ${formatUnits(relayFee, pool.decimals)} ${pool.symbol}` : ""}
          </label>
        ) : null}
      </Well>
      <div className="mt-3">
        {!viaRelayer && !w.address ? (
          <ConnectButton block large />
        ) : (
          <PrimaryButton size="lg" block className="h-[58px] text-[17px]" icon={<Unlock />} disabled={!pool || !isAddress(recipient) || !!stage} loading={!!stage} onClick={withdraw}>
            {stage ?? "Withdraw"}
          </PrimaryButton>
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline="Withdrawn" sub={`Proof made in ${(done.ms / 1000).toFixed(1)} s`} details={<span>Tx {short(done.hash, 6)}</span>} /> : null}
    </>
  );
}

export default function ShieldPage() {
  const { chains, ready } = usePrivacyChains();
  const [tab, setTab] = useState<"in" | "out">("in");
  if (ready && chains.length === 0) return <div className="mx-auto max-w-[500px] pt-[6vh]"><ScreenTitle title="Shield" pill={<><Shield size={13} /> ZK pool</>} /><NotLive /></div>;
  if (!chains.length) return null;
  return (
    <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[5vh]">
      <ScreenTitle title="Shield" pill={<><Shield size={13} /> ZK pool</>} />
      <GlassCard>
        <div className="flex gap-1 px-1.5 pt-1 pb-3">
          {(["in", "out"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-full px-4 py-1.5 text-[14px] font-medium", tab === t ? "bg-ui-surface-2" : "text-ui-muted hover:text-ui-text")}>
              {t === "in" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>
        {tab === "in" ? <Deposit /> : <Withdraw />}
      </GlassCard>
    </div>
  );
}
