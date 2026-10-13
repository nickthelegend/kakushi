"use client";

import { CopyButton, PrimaryButton, SecondaryButton, StatusPill, cn } from "@kakushi/ui";
import { ArrowUpRight, Eye, Inbox, KeyRound, Lock, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits, isAddress, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { buildRegisterKeysCalldata, readStealthMetaAddress, scanAnnouncements, stealthBalance, type AnnouncementLog, type StealthMatch } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { ChainCoin } from "@/components/coins";
import { readError, short } from "@/components/kit";
import { Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { nativeSymbol, stealthWallet, usePrivacyChains, type PrivacyChain } from "@/lib/privacy";
import { useRuntime } from "@/lib/runtime";
import { useStealthKeys } from "@/lib/stealth-keys";
import { useWallet } from "@/lib/wallet";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";
import { balanceHandle, confidentialMatch, moveFromStealth, reveal, walletSigner } from "@/lib/confidential";
import { useConfidential } from "@/lib/fhe-browser";

type Found = StealthMatch & { chainId: number };

const fmtUnits = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/**
 * A Kakushi Confidential payment to one of our stealth addresses: the amount is a ciphertext.
 * Reveal = EIP-712 user decryption signed by the STEALTH private key (the token lets the stealth
 * address read it). Move = the stealth address hands its encrypted balance to the main wallet
 * (paid from the gas the sender forwarded); the amount is never decrypted on the way.
 */
function ConfidentialPayment({ m, onDone }: { m: NonNullable<ReturnType<typeof confidentialMatch>> & { chainId: number }; onDone: (hash: Hex) => void }) {
  const { rpc } = useRuntime();
  const w = useWallet();
  const { env } = useConfidential();
  const [state, setState] = useState<{ amount: bigint; left: bigint } | null>(null);
  const [busy, setBusy] = useState<"reveal" | "move" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = chainById(m.chainId).key;
  const t = m.ctoken;
  const stealth = () => walletSigner(stealthWallet(m.stealthPrivateKey!, m.chainId, rpc[key]));

  async function doReveal() {
    if (!env || !m.stealthPrivateKey || busy) return;
    setBusy("reveal");
    setErr(null);
    try {
      const s = stealth();
      const bal = await balanceHandle(env, t, s.address);
      const v = await reveal(env, s, t, [m.encryptedAmount, bal]);
      setState({ amount: v[m.encryptedAmount.toLowerCase()] ?? 0n, left: v[bal.toLowerCase()] ?? 0n });
    } catch (e) {
      setErr(readError((e as Error).message) ?? "Reveal failed");
    } finally {
      setBusy(null);
    }
  }

  async function move() {
    if (!env || !m.stealthPrivateKey || !w.address || busy) return;
    setBusy("move");
    setErr(null);
    try {
      const rc = await moveFromStealth(env, stealth(), t, w.address as Hex);
      setState((s) => (s ? { ...s, left: 0n } : s));
      onDone(rc.transactionHash);
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(null);
    }
  }

  const moved = state !== null && state.left === 0n;

  return (
    <li className="rounded-[20px] bg-[#04060f]/80 p-4 ring-1 ring-white/[0.04]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-[#1a2a8a] ring-1 ring-[#3b55ff]/40"><Lock size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="ui-figure flex items-baseline gap-1.5 text-[20px] font-medium">
            <span className={cn(!state && "text-ui-dim")}>{state ? fmtUnits(state.amount, t.decimals) : "••••"}</span>
            <span className="text-[15px] font-semibold">{t.symbol}</span>
          </div>
          <div className="truncate text-[12px] text-ui-muted">{!state ? "Hidden amount" : moved ? "In your private balance" : "Only you can see this"} · {short(m.stealthAddress)}</div>
        </div>
        {!state ? (
          <SecondaryButton size="sm" icon={<Eye />} loading={busy === "reveal"} onClick={doReveal}>Reveal</SecondaryButton>
        ) : !moved ? (
          <SecondaryButton size="sm" loading={busy === "move"} disabled={!w.address} onClick={move} title={w.address ? undefined : "Connect a wallet first"}>Move to balance</SecondaryButton>
        ) : (
          <StatusPill tone="neutral" size="sm">Moved</StatusPill>
        )}
      </div>
      {state && !moved && !w.address ? <p className="mt-2 text-[13px] text-ui-muted">Connect a wallet to move it into your private balance.</p> : null}
      {err ? <p className="mt-2 text-[13px] text-ui-down">{err}</p> : null}
    </li>
  );
}

function Payment({ m, onDone }: { m: Found; onDone: (hash: Hex) => void }) {
  const { rpc, k } = useRuntime();
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const native = m.kind !== "erc20";
  const bal = m.balance ?? 0n;
  const key = chainById(m.chainId).key;

  async function withdraw() {
    if (!m.stealthPrivateKey || !isAddress(dest) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const client = k!.client(key);
      const gasPrice = await client.getGasPrice();
      const fee = (21_000n * gasPrice * 13n) / 10n;
      if (bal <= fee) throw new Error("Balance doesn't cover the gas to move it");
      const wc = stealthWallet(m.stealthPrivateKey, m.chainId, rpc[key]);
      const hash = await wc.sendTransaction({ to: dest as Hex, value: bal - fee, gas: 21_000n, gasPrice });
      requireSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), "Withdrawal");
      onDone(hash);
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[20px] bg-[#04060f]/80 p-4 ring-1 ring-white/[0.04]">
      <div className="flex items-center gap-3">
        <ChainCoin chainId={m.chainId} size={34} />
        <div className="min-w-0 flex-1">
          <div className="ui-figure text-[20px] font-medium">{formatUnits(bal, chainById(m.chainId).nativeDecimals).slice(0, 10)} {native ? nativeSymbol(m.chainId) : "tokens"}</div>
          <div className="text-[12px] text-ui-muted">{chainById(m.chainId).shortName} · {short(m.stealthAddress)}</div>
        </div>
        {bal > 10_000_000_000_000n && native ? (
          <SecondaryButton size="sm" onClick={() => setOpen((o) => !o)}>Withdraw</SecondaryButton>
        ) : (
          <StatusPill tone="neutral" size="sm">{bal > 0n && !native ? "Token" : "Empty"}</StatusPill>
        )}
      </div>
      {open ? (
        <div className="mt-3 flex gap-2">
          <input aria-label="Destination address" value={dest} onChange={(e) => setDest(e.target.value.trim())} placeholder="0x… a fresh wallet" className={cn(inputCls, "rounded-full bg-ui-surface-2 px-4 py-2.5 font-mono text-[13px]")} />
          <PrimaryButton size="sm" loading={busy} disabled={!isAddress(dest)} onClick={withdraw} iconRight={<ArrowUpRight />}>Send</PrimaryButton>
        </div>
      ) : null}
      {err ? <p className="mt-2 text-[13px] text-ui-down">{err}</p> : null}
    </li>
  );
}

function Register({ pc, meta }: { pc: PrivacyChain; meta: string }) {
  const { k } = useRuntime();
  const w = useWallet();
  const [state, setState] = useState<"unknown" | "on" | "off" | "busy">("unknown");
  useEffect(() => {
    if (!k || !w.address) return;
    let live = true;
    readStealthMetaAddress(k.client(pc.chain.key), pc.privacy.stealthRegistry, w.address as Hex)
      .then((m) => live && setState(m && m.toLowerCase() === meta.toLowerCase() ? "on" : "off"))
      .catch(() => live && setState("off"));
    return () => {
      live = false;
    };
  }, [k, w.address, pc, meta]);
  async function register() {
    setState("busy");
    try {
      const wc = await w.walletClient(pc.chain.key);
      const hash = await wc.sendTransaction({ chain: wc.chain, account: wc.account!, to: pc.privacy.stealthRegistry, data: buildRegisterKeysCalldata(meta) });
      requireSuccessfulReceipt(await k!.client(pc.chain.key).waitForTransactionReceipt({ hash }), "Register");
      setState("on");
    } catch {
      setState("off");
    }
  }
  return state === "on" ? (
    <StatusPill tone="lime" size="sm">Listed on {pc.chain.shortName}</StatusPill>
  ) : (
    <SecondaryButton size="sm" loading={state === "busy"} disabled={state === "unknown"} onClick={register}>
      List on {pc.chain.shortName}
    </SecondaryButton>
  );
}

/** History from Envio HyperSync (via /api/announcements); the inbox reads only newer blocks over RPC. */
async function announcementHistory(chainId: number, from: bigint): Promise<{ logs: AnnouncementLog[]; toBlock: bigint } | null> {
  const r = await fetch(`/api/announcements?chainId=${chainId}&from=${from}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { logs: { blockNumber: string; transactionHash: Hex; logIndex: number; topics: Hex[]; data: Hex }[]; toBlock: string };
  return { logs: j.logs.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) })), toBlock: BigInt(j.toBlock) };
}

export default function ReceivePage() {
  const { k, cfg } = useRuntime();
  const w = useWallet();
  const { keys, unlock } = useStealthKeys();
  const { chains, ready } = usePrivacyChains();
  const [unlocking, setUnlocking] = useState(false);
  const [scan, setScan] = useState<{ busy: boolean; found: Found[] | null; err: string | null }>({ busy: false, found: null, err: null });
  const [moved, setMoved] = useState<{ hash: Hex; confidential: boolean } | null>(null);

  async function runScan() {
    if (!keys || !k) return;
    setScan({ busy: true, found: null, err: null });
    try {
      const all: Found[] = [];
      const down: string[] = [];
      // one unreachable chain must not hide the others' payments
      for (const pc of chains) {
        try {
          const client = k.client(pc.chain.key);
          const latest = await client.getBlockNumber();
          const matches = await scanAnnouncements(client, pc.privacy.stealthAnnouncer, BigInt(pc.privacy.deployBlock), latest, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey, spendingKey: keys.spendingKey }, { withBalances: true, history: (from) => announcementHistory(pc.chain.chainId, from) });
          for (const m of matches) {
            // A private bridge payment is announced on the source chain; its funds sit on dstChainId.
            const dst = m.dstChainId ? Number(m.dstChainId) : pc.chain.chainId;
            if (dst === pc.chain.chainId || !chains.some((c) => c.chain.chainId === dst)) {
              all.push({ ...m, chainId: pc.chain.chainId });
              continue;
            }
            const dc = k.client(chainById(dst).key);
            const balance = m.kind === "erc20" && m.token ? await stealthBalance(dc, m.stealthAddress, m.token) : await dc.getBalance({ address: m.stealthAddress });
            all.push({ ...m, chainId: dst, balance });
          }
        } catch {
          down.push(pc.chain.shortName);
        }
      }
      if (down.length === chains.length) throw new Error("no chain reachable");
      setScan({ busy: false, found: all.sort((a, b) => Number(b.blockNumber - a.blockNumber)), err: down.length ? `Couldn't reach ${down.join(", ")}; showing the rest` : null });
    } catch (e) {
      setScan({ busy: false, found: null, err: readError((e as Error).message) });
    }
  }

  if (ready && chains.length === 0) return <div className="mx-auto max-w-[520px] pt-[6vh]"><ScreenTitle title="Receive privately" pill={<><Inbox size={13} /> Inbox</>} /><NotLive /></div>;

  return (
    <div className="mx-auto w-full max-w-[520px] pt-6 pb-20 sm:pt-[5vh]">
      <ScreenTitle title="Receive privately" pill={<><Inbox size={13} /> Inbox</>} />
      <GlassCard>
        <Well>
          <div className="text-[13px] text-ui-muted">Your private address</div>
          {keys ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[15px]">{keys.metaAddress.slice(0, 22)}…{keys.metaAddress.slice(-6)}</span>
                <CopyButton value={keys.metaAddress} label="private address" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">{chains.map((pc) => <Register key={pc.chain.chainId} pc={pc} meta={keys.metaAddress} />)}</div>
            </>
          ) : w.address ? (
            <PrimaryButton size="lg" block className="mt-3" icon={<KeyRound />} loading={unlocking} onClick={() => { setUnlocking(true); unlock().catch(() => {}).finally(() => setUnlocking(false)); }}>
              Unlock with your wallet
            </PrimaryButton>
          ) : (
            <div className="mt-3"><ConnectButton block large /></div>
          )}
        </Well>
        {keys ? (
          <div className="mt-2 px-1">
            <div className="flex items-center justify-between px-2 py-2">
              <span className="text-[15px] font-medium">Inbox{scan.found ? ` · ${scan.found.length}` : ""}</span>
              <button type="button" onClick={runScan} disabled={scan.busy} className="inline-flex items-center gap-1.5 text-[13px] text-ui-muted hover:text-ui-text disabled:opacity-50">
                <RefreshCw size={14} className={scan.busy ? "animate-spin" : undefined} /> {scan.busy ? "Scanning…" : "Scan"}
              </button>
            </div>
            {scan.err ? <p className="px-2 pb-2 text-[13px] text-ui-warn">{scan.err}</p> : null}
            {scan.found?.length === 0 ? <p className="px-2 pb-3 text-[14px] text-ui-muted">No payments yet. Share your private address to get paid.</p> : null}
            <ul className="grid gap-2 pb-1">
              {scan.found?.map((m) => {
                const c = confidentialMatch(m, cfg?.fhe ?? null);
                const rowKey = `${m.chainId}-${m.txHash}-${m.logIndex}`;
                return c ? <ConfidentialPayment key={rowKey} m={{ ...c, chainId: m.chainId }} onDone={(h) => setMoved({ hash: h, confidential: true })} /> : <Payment key={rowKey} m={m} onDone={(h) => { setMoved({ hash: h, confidential: false }); void runScan(); }} />;
              })}
            </ul>
          </div>
        ) : null}
      </GlassCard>
      {moved ? <Done headline={moved.confidential ? "Moved to your private balance" : "Moved to your wallet"} sub={moved.confidential ? "The amount stayed encrypted the whole way" : undefined} details={<span>Tx {short(moved.hash, 6)}</span>} /> : null}
    </div>
  );
}
