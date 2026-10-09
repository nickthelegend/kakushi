"use client";

import { PrimaryButton, cn } from "@kakushi/ui";
import { Check, EyeOff, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { isAddress, parseUnits, toHex, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { generateStealthAddress, readStealthMetaAddress } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { readError, short } from "@/components/kit";
import { ChainSelect, Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { nativeSymbol, stealthPayAbi, usePrivacyChains } from "@/lib/privacy";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";
import { requireSuccessfulReceipt } from "@/lib/bridge-state";

type Resolved = { meta: string; via: "meta" | "registry" } | { error: string } | null;

export default function SendPage() {
  const { k } = useRuntime();
  const w = useWallet();
  const { chains, ready } = usePrivacyChains();
  const [chainId, setChainId] = useState<number>(10143);
  const pc = chains.find((c) => c.chain.chainId === chainId) ?? chains[0];
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("0.1");
  const [resolved, setResolved] = useState<Resolved>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ hash: Hex; stealth: Hex; amount: string; chainId: number } | null>(null);

  // A meta-address works as is; a wallet address is looked up in the ERC-6538 registry.
  useEffect(() => {
    const v = to.trim();
    setResolved(null);
    if (!v) return;
    if (v.startsWith("st:")) return setResolved({ meta: v, via: "meta" });
    if (!isAddress(v) || !k || !pc) return setResolved(isAddress(v) ? null : { error: "Paste a meta-address (st:eth:0x…) or a wallet address" });
    let live = true;
    readStealthMetaAddress(k.client(pc.chain.key), pc.privacy.stealthRegistry, v as Hex)
      .then((m) => live && setResolved(m ? { meta: m, via: "registry" } : { error: "This wallet hasn't turned on private receiving" }))
      .catch((e) => live && setResolved({ error: readError((e as Error).message) ?? "Lookup failed" }));
    return () => {
      live = false;
    };
  }, [to, k, pc]);

  if (ready && !pc) return <div className="mx-auto max-w-[500px] pt-[6vh]"><ScreenTitle title="Send privately" pill={<><EyeOff size={13} /> Stealth</>} /><NotLive /></div>;
  if (!pc) return null;

  const symbol = nativeSymbol(pc.chain.chainId);
  const meta = resolved && "meta" in resolved ? resolved.meta : null;
  let value: bigint | null = null;
  try {
    value = parseUnits(amount || "0", pc.chain.nativeDecimals);
  } catch {}

  async function send() {
    if (!meta || !value || !pc || busy) return;
    setErr(null);
    setDone(null);
    try {
      setBusy("Making a one-time address…");
      const s = generateStealthAddress(meta);
      const wc = await w.walletClient(pc.chain.key);
      setBusy("Confirm in your wallet…");
      const hash = await wc.writeContract({ chain: wc.chain, account: wc.account!, address: pc.privacy.stealthPay, abi: stealthPayAbi, functionName: "sendNative", args: [1n, s.stealthAddress, s.ephemeralPublicKey, toHex(s.viewTag, { size: 1 })], value });
      setBusy("Sending…");
      requireSuccessfulReceipt(await k!.client(pc.chain.key).waitForTransactionReceipt({ hash }), "Private send");
      setDone({ hash, stealth: s.stealthAddress, amount, chainId: pc.chain.chainId });
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0]!);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[5vh]">
      <ScreenTitle title="Send privately" pill={<><EyeOff size={13} /> Stealth</>} />
      <GlassCard>
        <Well>
          <div className="flex items-center justify-between text-[13px] text-ui-muted">
            <span>To</span>
            {meta ? <span className="inline-flex items-center gap-1 text-[#c4d0ff]"><Check size={13} /> {resolved && "via" in resolved && resolved.via === "registry" ? "Private address found" : "Meta-address"}</span> : null}
          </div>
          <input aria-label="Recipient meta-address or wallet" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="st:eth:0x… or 0x wallet" className={cn(inputCls, "mt-2 font-mono text-[14px]")} />
          {resolved && "error" in resolved ? <p className="mt-2 text-[13px] text-ui-warn">{resolved.error}</p> : null}
        </Well>
        <Well className="mt-2">
          <div className="flex items-center justify-between text-[13px] text-ui-muted">
            <span>Amount</span>
            <ChainSelect chains={chains} value={pc.chain.chainId} onChange={setChainId} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <input aria-label={`Amount of ${symbol}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="ui-figure min-w-0 flex-1 bg-transparent text-[40px] font-medium tracking-[-0.03em] outline-none" />
            <span className="text-[17px] font-semibold">{symbol}</span>
          </div>
        </Well>
        <div className="mt-3">
          {w.address ? (
            <PrimaryButton size="lg" block icon={<Send />} className="h-[58px] text-[17px]" disabled={!meta || !value || !!busy} loading={!!busy} onClick={send}>
              {busy ?? "Send privately"}
            </PrimaryButton>
          ) : (
            <ConnectButton block large />
          )}
        </div>
        {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      </GlassCard>
      {done ? (
        <Done
          headline={<>Sent {done.amount} {nativeSymbol(done.chainId)}</>}
          sub="Only the recipient can find it"
          details={
            <>
              <span>One-time address {short(done.stealth, 6)}</span>
              <span>Tx {short(done.hash, 6)} on {chainById(done.chainId).shortName}</span>
            </>
          }
        />
      ) : null}
    </div>
  );
}
