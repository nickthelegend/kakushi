"use client";

import { CopyButton, PrimaryButton, cn } from "@kakushi/ui";
import { Download, Lock, Plus, Shield, Unlock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, isAddress, isHex, parseAbi, parseUnits, toHex, zeroAddress, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { IncrementalMerkleTree, fieldToHex, generateNote, generateStealthAddress, noteCommitment, noteNullifierHash, parseNote, privateCallWitness, readStealthMetaAddress, serializeNote, type Note } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { readError, short } from "@/components/kit";
import { ChainSelect, Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { erc20ApproveAbi, factoryAbi, loadPools, poolAbi, stealthPayAbi, usePrivacyChains, type PoolInfo, type PrivacyChain } from "@/lib/privacy";
import { proveInBrowser } from "@/lib/prove";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

const hx = (x: bigint) => `0x${x.toString(16)}`;
const withdrawAndCallAbi = parseAbi(["function withdrawAndCall(bytes proof, bytes32 root, bytes32 nullifierHash, address relayer, uint256 fee, address target, bytes data, address refundTo)"]);
const erc20Meta = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const fmtPool = (p: PoolInfo) => `${formatUnits(BigInt(p.denomination), p.decimals)} ${p.symbol}`;

/** Every pool on a chain, curated and community, refreshed on demand. */
function usePools(pc: PrivacyChain | undefined) {
  const { k } = useRuntime();
  const [pools, setPools] = useState<PoolInfo[] | null>(null);
  const reload = useCallback(() => {
    if (!k || !pc) return;
    loadPools(k.client(pc.chain.key), pc).then(setPools).catch(() => setPools(Object.values(pc.privacy.pools)));
  }, [k, pc]);
  useEffect(reload, [reload]);
  return { pools, reload };
}

function CreatePool({ pc, onCreated }: { pc: PrivacyChain; onCreated: () => void }) {
  const { k } = useRuntime();
  const w = useWallet();
  const factory = (pc.privacy as { poolFactory?: Hex }).poolFactory;
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!factory) return null;
  async function create() {
    if (busy || !amount) return;
    setBusy(true);
    setMsg(null);
    try {
      const client = k!.client(pc.chain.key);
      const native = token.trim() === "" || token.trim().toLowerCase() === "native";
      if (!native && !isAddress(token)) throw new Error("Enter a token address, or leave it empty for the native coin");
      const decimals = native ? pc.chain.nativeDecimals : Number(await client.readContract({ address: token as Hex, abi: erc20Meta, functionName: "decimals" }));
      const wc = await w.walletClient(pc.chain.key);
      const hash = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: factory!, abi: factoryAbi, functionName: "createPool", args: [native ? zeroAddress : (token as Hex), parseUnits(amount, decimals)] });
      requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), "Create pool");
      setMsg("Pool created");
      setToken("");
      setAmount("");
      onCreated();
    } catch (e) {
      setMsg(readError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message) ?? "Couldn't create the pool");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="group mt-2 rounded-[22px] bg-[#04060f]/80 px-5 py-4 ring-1 ring-white/[0.04]">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] text-ui-muted [&::-webkit-details-marker]:hidden">
        <Plus size={15} /> Any token: open a private pool
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
        <input aria-label="Token address" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="0x… token (empty = native)" className="h-10 rounded-full bg-ui-surface-2 px-4 font-mono text-[13px] outline-none" />
        <input aria-label="Pool size" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Size" className="h-10 rounded-full bg-ui-surface-2 px-4 text-[13px] outline-none" />
        <PrimaryButton size="sm" className="h-10" loading={busy} disabled={!amount || !w.address} onClick={create}>Create</PrimaryButton>
      </div>
      {msg ? <p className="mt-2 text-[13px] text-ui-muted">{msg}</p> : null}
    </details>
  );
}

function Deposit() {
  const { k } = useRuntime();
  const w = useWallet();
  const { chains } = usePrivacyChains();
  const [chainId, setChainId] = useState(10143);
  const pc = chains.find((c) => c.chain.chainId === chainId) ?? chains[0]!;
  const { pools, reload } = usePools(pc);
  const [addr, setAddr] = useState<string | null>(null);
  const pool = pools?.find((p) => p.address === addr) ?? pools?.[0];
  const [note, setNote] = useState<Note | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; label: string } | null>(null);
  useEffect(() => {
    setAddr(null);
    setNote(null);
    setSaved(false);
  }, [pc]);

  function download(n: Note) {
    const blob = new Blob([serializeNote(n)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kakushi-note-${pc.chain.chainId}-${pool ? fmtPool(pool).replace(/\s/g, "") : "pool"}.txt`;
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
      setDone({ hash, label: fmtPool(pool) });
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
          {(pools ?? []).map((p) => (
            <button key={p.address} type="button" onClick={() => { setAddr(p.address); setNote(null); setSaved(false); }} className={cn("rounded-full px-4 py-2 text-[15px] font-medium ring-1 transition-colors", pool?.address === p.address ? "bg-[#16205a] text-white ring-[#3b55ff]/60" : "bg-ui-surface-2 text-ui-muted ring-transparent hover:text-ui-text")}>
              {fmtPool(p)}
              {p.community ? <span className="ml-1.5 text-[11px] text-[#f2c27a]">new</span> : null}
            </button>
          ))}
        </div>
      </Well>
      <CreatePool pc={pc} onCreated={reload} />
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
            Shield {pool ? fmtPool(pool) : ""}
          </PrimaryButton>
        ) : (
          <PrimaryButton size="lg" block className="h-[58px] text-[17px]" icon={<Lock />} disabled={!saved || !!busy} loading={!!busy} onClick={deposit}>
            {busy ?? (saved ? "Deposit" : "Save your note first")}
          </PrimaryButton>
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline={`Shielded ${done.label}`} sub="Withdraw any time with your note" details={<span>Tx {short(done.hash, 6)}</span>} /> : null}
    </>
  );
}

type Mode = "address" | "pay" | "call";

function Withdraw() {
  const { k, cfg } = useRuntime();
  const w = useWallet();
  const { chains } = usePrivacyChains();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("address");
  const [recipient, setRecipient] = useState("");
  const [target, setTarget] = useState("");
  const [data, setData] = useState("0x");
  const [refundTo, setRefundTo] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
  const [relayer, setRelayer] = useState<{ address: Hex; feeByPool: Record<string, Record<string, string>> } | null>(null);
  const [pools, setPools] = useState<PoolInfo[] | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; ms: number; mode: Mode } | null>(null);
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
  const pc = note ? chains.find((c) => c.chain.chainId === note.chainId) : undefined;
  useEffect(() => {
    setPools(null);
    if (k && pc) loadPools(k.client(pc.chain.key), pc).then(setPools).catch(() => setPools(Object.values(pc.privacy.pools)));
  }, [k, pc]);
  const pool = pc && note ? pools?.find((p) => p.address.toLowerCase() === note.pool.toLowerCase()) : null;
  const relayFee = relayer && note ? BigInt(relayer.feeByPool[String(note.chainId)]?.[note.pool.toLowerCase()] ?? relayer.feeByPool[String(note.chainId)]?.[note.pool] ?? "-1") : -1n;
  const viaRelayer = Boolean(useRelayer && relayer && relayFee >= 0n);
  const ready = pool && (mode === "address" ? isAddress(recipient) : mode === "pay" ? recipient.length > 0 : isAddress(target) && isHex(data) && isAddress(refundTo));

  async function withdraw() {
    if (!note || !pc || !pool || !ready || stage) return;
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
      const root = fieldToHex(path.root);

      // Private call: either "pay privately" (into StealthPay, to a fresh stealth address) or any contract call.
      let call: { target: Hex; data: Hex; refundTo: Hex } | null = null;
      if (mode === "pay") {
        setStage("Resolving the recipient…");
        let meta = recipient.trim();
        if (!meta.startsWith("st:")) {
          if (!isAddress(meta)) throw new Error("Enter a meta-address (st:eth:0x…) or a wallet");
          const m = await readStealthMetaAddress(client, pc.privacy.stealthRegistry, meta as Hex);
          if (!m) throw new Error("This wallet hasn't turned on private receiving");
          meta = m;
        }
        const s = generateStealthAddress(meta);
        const amount = BigInt(pool.denomination) - fee;
        const native = pool.token === zeroAddress;
        const callData = native
          ? encodeFunctionData({ abi: stealthPayAbi, functionName: "sendNative", args: [1n, s.stealthAddress, s.ephemeralPublicKey, toHex(s.viewTag, { size: 1 })] })
          : encodeFunctionData({ abi: stealthPayAbi, functionName: "sendToken", args: [1n, s.stealthAddress, pool.token, amount, s.ephemeralPublicKey, toHex(s.viewTag, { size: 1 })] });
        call = { target: pc.privacy.stealthPay, data: callData, refundTo: s.stealthAddress };
      } else if (mode === "call") {
        call = { target: target as Hex, data: data as Hex, refundTo: refundTo as Hex };
      }

      const inputs = call
        ? privateCallWitness(note, tree, { relayer: relayerAddr, fee, call }).inputs
        : {
            root: hx(path.root), nullifier_hash: hx(nullifierHash), recipient: hx(BigInt(recipient)), relayer: hx(BigInt(relayerAddr)),
            fee: hx(fee), refund: "0x0", chain_id: hx(BigInt(pc.chain.chainId)), pool: hx(BigInt(pool.address)), ext_data_hash: "0x0",
            nullifier: hx(note.nullifier), secret: hx(note.secret), path: path.pathElements.map(hx), path_bits: path.pathIndices,
          };
      setStage("Proving in your browser…");
      const proof = await proveInBrowser("shielded_withdraw", inputs, (s) => setStage(s === "witness" ? "Computing the witness…" : "Proving in your browser…"));
      let hash: Hex;
      if (viaRelayer) {
        setStage("Relaying…");
        const args = { root, nullifierHash: fieldToHex(nullifierHash), recipient: call ? undefined : recipient, relayer: relayerAddr, fee: fee.toString(), refund: "0" };
        const r = await fetch("/api/svc/relayer/relay", { method: "POST", body: JSON.stringify({ chainId: pc.chain.chainId, pool: pool.address, proof: proof.proof, args, ...(call ? { call } : {}) }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The relayer refused the withdrawal");
        hash = j.txHash;
      } else {
        setStage("Confirm in your wallet…");
        const wc = await w.walletClient(pc.chain.key);
        hash = call
          ? await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pool.address, abi: withdrawAndCallAbi, functionName: "withdrawAndCall", args: [proof.proof, root, fieldToHex(nullifierHash), relayerAddr, 0n, call.target, call.data, call.refundTo] })
          : await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pool.address, abi: poolAbi, functionName: "withdraw", args: [proof.proof, root, fieldToHex(nullifierHash), recipient as Hex, relayerAddr, 0n, 0n] });
      }
      setStage("Withdrawing…");
      requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), "Withdrawal");
      setDone({ hash, ms: proof.ms, mode });
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
        {note && pools && !pool ? <p className="mt-1 text-[13px] text-ui-warn">This note&rsquo;s pool isn&rsquo;t on this network</p> : null}
        {pool ? <p className="mt-1 text-[13px] text-[#c4d0ff]">{fmtPool(pool)} on {chainById(note!.chainId).shortName}</p> : null}
      </Well>
      <Well className="mt-2">
        <div className="flex gap-1 rounded-full bg-ui-surface-2 p-1">
          {([["address", "To a wallet"], ["pay", "Pay privately"], ["call", "Contract call"]] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium", mode === m ? "bg-[#16205a] text-white" : "text-ui-muted hover:text-ui-text")}>
              {label}
            </button>
          ))}
        </div>
        {mode === "call" ? (
          <div className="mt-3 grid gap-2">
            <input aria-label="Target contract" value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder="0x… contract" className={cn(inputCls, "font-mono text-[13px]")} />
            <input aria-label="Call data" value={data} onChange={(e) => setData(e.target.value.trim())} placeholder="0x… calldata" className={cn(inputCls, "font-mono text-[13px]")} />
            <input aria-label="Leftovers to" value={refundTo} onChange={(e) => setRefundTo(e.target.value.trim())} placeholder="0x… leftovers to" className={cn(inputCls, "font-mono text-[13px]")} />
          </div>
        ) : (
          <input aria-label="Recipient" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder={mode === "pay" ? "st:eth:0x… or registered wallet" : "0x… a fresh wallet"} className={cn(inputCls, "mt-3 font-mono text-[14px]")} />
        )}
        {relayer ? (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ui-muted">
            <input type="checkbox" checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} className="accent-[#2f47f5]" />
            Gasless via relayer{relayFee >= 0n && pool ? ` · fee ${formatUnits(relayFee, pool.decimals)} ${pool.symbol}` : pool ? " · not for this pool" : ""}
          </label>
        ) : null}
      </Well>
      <div className="mt-3">
        {!viaRelayer && !w.address ? (
          <ConnectButton block large />
        ) : (
          <PrimaryButton size="lg" block className="h-[58px] text-[17px]" icon={<Unlock />} disabled={!ready || !!stage} loading={!!stage} onClick={withdraw}>
            {stage ?? (mode === "pay" ? "Pay privately" : mode === "call" ? "Call privately" : "Withdraw")}
          </PrimaryButton>
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline={done.mode === "pay" ? "Paid privately from the pool" : done.mode === "call" ? "Called privately" : "Withdrawn"} sub={`Proof made in ${(done.ms / 1000).toFixed(1)} s`} details={<span>Tx {short(done.hash, 6)}</span>} /> : null}
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
