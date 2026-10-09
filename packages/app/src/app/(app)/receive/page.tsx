"use client";

import { CopyButton, PrimaryButton, SecondaryButton, StatusPill, cn } from "@kakushi/ui";
import { ArrowUpRight, Inbox, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatUnits, isAddress, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { buildRegisterKeysCalldata, readStealthMetaAddress, scanAnnouncements, type StealthMatch } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { ChainCoin } from "@/components/coins";
import { readError, short } from "@/components/kit";
import { Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { nativeSymbol, stealthWallet, usePrivacyChains, type PrivacyChain } from "@/lib/privacy";
import { useRuntime } from "@/lib/runtime";
import { useStealthKeys } from "@/lib/stealth-keys";
import { useWallet } from "@/lib/wallet";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

type Found = StealthMatch & { chainId: number };

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

export default function ReceivePage() {
  const { k } = useRuntime();
  const w = useWallet();
  const { keys, unlock } = useStealthKeys();
  const { chains, ready } = usePrivacyChains();
  const [unlocking, setUnlocking] = useState(false);
  const [scan, setScan] = useState<{ busy: boolean; found: Found[] | null; err: string | null }>({ busy: false, found: null, err: null });
  const [moved, setMoved] = useState<Hex | null>(null);

  async function runScan() {
    if (!keys || !k) return;
    setScan({ busy: true, found: null, err: null });
    try {
      const all: Found[] = [];
      for (const pc of chains) {
        const client = k.client(pc.chain.key);
        const latest = await client.getBlockNumber();
        const matches = await scanAnnouncements(client, pc.privacy.stealthAnnouncer, BigInt(pc.privacy.deployBlock), latest, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey, spendingKey: keys.spendingKey }, { withBalances: true });
        all.push(...matches.map((m) => ({ ...m, chainId: pc.chain.chainId })));
      }
      setScan({ busy: false, found: all.sort((a, b) => Number(b.blockNumber - a.blockNumber)), err: null });
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
                <RefreshCw size={14} className={scan.busy ? "animate-spin" : undefined} /> {scan.busy ? "Scanning" : "Scan"}
              </button>
            </div>
            {scan.err ? <p className="px-2 pb-2 text-[13px] text-ui-warn">{scan.err}</p> : null}
            {scan.found?.length === 0 ? <p className="px-2 pb-3 text-[14px] text-ui-muted">Nothing yet</p> : null}
            <ul className="grid gap-2 pb-1">{scan.found?.map((m) => <Payment key={`${m.chainId}-${m.txHash}-${m.logIndex}`} m={m} onDone={(h) => { setMoved(h); void runScan(); }} />)}</ul>
          </div>
        ) : null}
      </GlassCard>
      {moved ? <Done headline="Moved to your wallet" details={<span>Tx {short(moved, 6)}</span>} /> : null}
    </div>
  );
}
