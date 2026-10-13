"use client";

import { CopyButton, Menu, PrimaryButton, cn } from "@kakushi/ui";
import { ArrowDownToLine, Check, ChevronDown, Eye, EyeOff, Gift, Link2, Lock, LockOpen, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEther, formatUnits, isAddress, parseUnits, stringToHex, type Hex } from "viem";
import { readStealthMetaAddress } from "@kakushi/sdk";
import { ConnectButton } from "@/components/AppShell";
import { readError, short } from "@/components/kit";
import { Done, GlassCard, NotLive, ScreenTitle, Well, inputCls } from "@/components/privacy-ui";
import { balanceHandle, claimPayLink, createPayLink, parsePayLinkFragment, payEncrypted, payLinkFragment, payStealth, publicBalance, readPayLink, reveal, stealthGas, unwrap, wrap, type ConfidentialToken } from "@/lib/confidential";
import { isolated, lastEncryption, useConfidential } from "@/lib/fhe-browser";
import { usePrivacyChains } from "@/lib/privacy";
import { useRuntime } from "@/lib/runtime";
import { useWallet } from "@/lib/wallet";

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const errText = (e: unknown) => readError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message?.split("\n")[0] ?? String(e)) ?? "Something went wrong";
const COI_RELOAD = "kakushi.coi-reload";

function parseAmount(v: string, decimals: number): bigint | null {
  try {
    const x = parseUnits(v || "0", decimals);
    return x > 0n ? x : null;
  } catch {
    return null;
  }
}

function TokenPicker({ tokens, value, onChange }: { tokens: ConfidentialToken[]; value: ConfidentialToken; onChange: (t: ConfidentialToken) => void }) {
  if (tokens.length < 2) return <span className="text-[17px] font-semibold">{value.symbol}</span>;
  return (
    <Menu
      label="Token"
      width={240}
      trigger={
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ui-surface-2 px-3 text-[13px] font-medium hover:bg-ui-surface-3">
          {value.symbol}
          <ChevronDown aria-hidden size={14} className="text-ui-muted" />
        </span>
      }
    >
      {tokens.map((t) => (
        <Menu.Item key={t.address} description={`Private ${t.underlyingSymbol}`} onSelect={() => onChange(t)}>
          {t.symbol}
        </Menu.Item>
      ))}
    </Menu>
  );
}

function Segments<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className={cn("rounded-full px-4 py-1.5 text-[14px] font-medium", value === o.id ? "bg-ui-surface-2" : "text-ui-muted hover:text-ui-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function encDetail() {
  return lastEncryption.ms ? <span>Encrypted in this tab in {lastEncryption.ms} ms ({lastEncryption.threads ? "WASM thread pool" : "single-threaded WASM"})</span> : null;
}

// ------------------------------------------------------------------ Balance: make private, reveal, cash out

function BalanceTab({ token }: { token: ConfidentialToken }) {
  const w = useWallet();
  const { env, signer } = useConfidential();
  const [pub, setPub] = useState<bigint | null>(null);
  const [priv, setPriv] = useState<bigint | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [mode, setMode] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ headline: string; sub: string; details: string[] } | null>(null);
  const value = parseAmount(amount, token.decimals);

  useEffect(() => {
    setPriv(null);
    setPub(null);
    if (!env || !w.address) return;
    let live = true;
    publicBalance(env, token, w.address).then((b) => live && setPub(b)).catch(() => {});
    return () => {
      live = false;
    };
  }, [env, token, w.address, done]);

  async function doReveal() {
    if (!env || revealing) return;
    setRevealing(true);
    setErr(null);
    try {
      const s = await signer();
      const h = await balanceHandle(env, token, s.address);
      setPriv((await reveal(env, s, token, [h]))[h.toLowerCase()] ?? 0n);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setRevealing(false);
    }
  }

  async function act() {
    if (!env || !value || busy) return;
    setErr(null);
    setDone(null);
    try {
      const s = await signer();
      if (mode === "in") {
        const rc = await wrap(env, s, token, value, setBusy);
        setDone({ headline: `${fmt(value, token.decimals)} ${token.underlyingSymbol} is now private`, sub: "From here on, only you can see how much you hold", details: [`Wrap tx ${short(rc.transactionHash, 6)}`, `The deposit itself is public; every later move is encrypted`] });
      } else {
        const out = await unwrap(env, s, token, value, setBusy);
        setDone({
          headline: out.released > 0n ? `Cashed out ${fmt(out.released, token.decimals)} ${token.underlyingSymbol}` : "Nothing cashed out",
          sub: out.released > 0n ? "Only this amount was ever revealed" : "Your private balance was lower than that amount",
          details: [`Cash-out tx ${short(out.receipt.transactionHash, 6)}`, `Decryption request #${out.requestId} (k-of-n KMS callback)`],
        });
      }
      setPriv(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Well>
        <div className="flex items-center justify-between text-[13px] text-ui-muted">
          <span>Private balance</span>
          {w.address ? (
            <button type="button" onClick={doReveal} disabled={revealing} className="inline-flex items-center gap-1.5 hover:text-ui-text disabled:opacity-50">
              {priv === null ? <Eye size={14} /> : <EyeOff size={14} />} {revealing ? "Revealing" : priv === null ? "Reveal" : "Refresh"}
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="ui-figure text-[40px] font-medium tracking-[-0.03em]">{priv === null ? "••••••" : fmt(priv, token.decimals)}</span>
          <span className="text-[17px] font-semibold">{token.symbol}</span>
        </div>
        <div className="mt-1 text-[13px] text-ui-muted">{priv === null ? "Encrypted on-chain. Reveal asks your wallet for one signature." : "Decrypted for this tab only"}{pub !== null ? ` · Public ${token.underlyingSymbol} ${fmt(pub, token.decimals)}` : ""}</div>
      </Well>
      <Well className="mt-2">
        <div className="flex items-center justify-between">
          <Segments value={mode} onChange={(m) => { setMode(m); setDone(null); }} options={[{ id: "in", label: "Make private" }, { id: "out", label: "Cash out" }]} />
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <input aria-label={`Amount of ${mode === "in" ? token.underlyingSymbol : token.symbol}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="ui-figure min-w-0 flex-1 bg-transparent text-[34px] font-medium tracking-[-0.03em] outline-none" />
          <span className="text-[15px] font-semibold">{mode === "in" ? token.underlyingSymbol : token.symbol}</span>
        </div>
      </Well>
      <div className="mt-3">
        {w.address ? (
          <PrimaryButton size="lg" block icon={mode === "in" ? <Lock /> : <LockOpen />} className="h-[58px] text-[17px]" disabled={!value || !!busy} loading={!!busy} onClick={act}>
            {busy ?? (mode === "in" ? `Make ${token.underlyingSymbol} private` : "Cash out")}
          </PrimaryButton>
        ) : (
          <ConnectButton block large />
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline={done.headline} sub={done.sub} details={<>{done.details.map((d) => <span key={d}>{d}</span>)}{mode === "out" ? encDetail() : null}</>} /> : null}
    </>
  );
}

// ------------------------------------------------------------------ Pay: encrypted amount, optionally to a stealth address

type Resolved = { meta: string; via: "meta" | "registry" } | { error: string } | null;

function PayTab({ token }: { token: ConfidentialToken }) {
  const { k } = useRuntime();
  const w = useWallet();
  const { env, signer } = useConfidential();
  const { chains } = usePrivacyChains();
  const hub = chains.find((c) => c.chain.chainId === env?.cfg.chainId) ?? null;
  const [privateTo, setPrivateTo] = useState(true);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("5");
  const [resolved, setResolved] = useState<Resolved>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ headline: string; sub: string; details: string[] } | null>(null);
  const value = parseAmount(amount, token.decimals);

  // private recipient: a meta-address works as is; a wallet is looked up in the ERC-6538 registry
  useEffect(() => {
    const v = to.trim();
    setResolved(null);
    if (!privateTo || !v) return;
    if (v.startsWith("st:")) return setResolved({ meta: v, via: "meta" });
    if (!isAddress(v)) return setResolved({ error: "Paste a meta-address (st:eth:0x…) or a wallet address" });
    if (!k || !hub) return setResolved({ error: "Private receiving isn't deployed on this network" });
    let live = true;
    readStealthMetaAddress(k.client(hub.chain.key), hub.privacy.stealthRegistry, v as Hex)
      .then((m) => live && setResolved(m ? { meta: m, via: "registry" } : { error: "This wallet hasn't turned on private receiving (Receive page)" }))
      .catch((e) => live && setResolved({ error: readError((e as Error).message) ?? "Lookup failed" }));
    return () => {
      live = false;
    };
  }, [to, privateTo, k, hub]);

  const meta = resolved && "meta" in resolved ? resolved.meta : null;
  const ready = privateTo ? Boolean(meta) : isAddress(to.trim());

  async function send() {
    if (!env || !value || !ready || busy) return;
    setErr(null);
    setDone(null);
    try {
      const s = await signer();
      if (privateTo && meta) {
        const r = await payStealth(env, s, token, meta, value, await stealthGas(env), setBusy);
        setDone({
          headline: `Sent ${fmt(value, token.decimals)} ${token.symbol}`,
          sub: "Nobody else can see who got it or how much",
          details: [`One-time address ${short(r.stealthAddress, 6)}`, `Includes ${formatEther(r.gas)} MON so they can move it`, `Announced with FHE metadata (0xfe0000fe)`, `Tx ${short(r.receipt.transactionHash, 6)}`],
        });
      } else {
        const r = await payEncrypted(env, s, token, to.trim() as Hex, value, stringToHex("kakushi", { size: 32 }), setBusy);
        setDone({ headline: `Sent ${fmt(value, token.decimals)} ${token.symbol}`, sub: `Only you and ${short(to.trim())} can see how much`, details: [`Tx ${short(r.receipt.transactionHash, 6)}`, ...(r.sent ? [`Amount on-chain: ciphertext ${short(r.sent, 8)}`] : [])] });
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Well>
        <div className="flex items-center justify-between text-[13px] text-ui-muted">
          <Segments value={privateTo ? "p" : "a"} onChange={(v) => { setPrivateTo(v === "p"); setDone(null); }} options={[{ id: "p", label: "Private recipient" }, { id: "a", label: "Address" }]} />
          {privateTo && meta ? <span className="inline-flex items-center gap-1 text-[#c4d0ff]"><Check size={13} /> {resolved && "via" in resolved && resolved.via === "registry" ? "Found" : "Meta-address"}</span> : null}
        </div>
        <input aria-label={privateTo ? "Recipient meta-address or wallet" : "Recipient address"} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={privateTo ? "st:eth:0x… or 0x wallet" : "0x… wallet"} className={cn(inputCls, "mt-3 font-mono text-[14px]")} />
        {resolved && "error" in resolved ? <p className="mt-2 text-[13px] text-ui-warn">{resolved.error}</p> : null}
      </Well>
      <Well className="mt-2">
        <div className="text-[13px] text-ui-muted">Amount, encrypted before it leaves this tab</div>
        <div className="mt-3 flex items-baseline gap-2">
          <input aria-label={`Amount of ${token.symbol}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="ui-figure min-w-0 flex-1 bg-transparent text-[40px] font-medium tracking-[-0.03em] outline-none" />
          <span className="text-[17px] font-semibold">{token.symbol}</span>
        </div>
      </Well>
      <div className="mt-3">
        {w.address ? (
          <PrimaryButton size="lg" block icon={<Send />} className="h-[58px] text-[17px]" disabled={!value || !ready || !!busy} loading={!!busy} onClick={send}>
            {busy ?? "Pay privately"}
          </PrimaryButton>
        ) : (
          <ConnectButton block large />
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {done ? <Done headline={done.headline} sub={done.sub} details={<>{done.details.map((d) => <span key={d}>{d}</span>)}{encDetail()}</>} /> : null}
    </>
  );
}


// ------------------------------------------------------------------ Pay links: send an encrypted amount to anyone, by link

function LinkTab({ token }: { token: ConfidentialToken }) {
  const w = useWallet();
  const { env, signer } = useConfidential();
  const [amount, setAmount] = useState("3");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; id: bigint; tx: Hex } | null>(null);
  const value = parseAmount(amount, token.decimals);

  async function create() {
    if (!env || !value || busy) return;
    setErr(null);
    setLink(null);
    try {
      const r = await createPayLink(env, await signer(), token, value, Math.max(0.01, Number(days) || 7), setBusy);
      setLink({ url: `${location.origin}/confidential#${payLinkFragment(token.address, r.id, r.key)}`, id: r.id, tx: r.receipt.transactionHash });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Well>
        <div className="text-[13px] text-ui-muted">Amount, encrypted and held until someone opens the link</div>
        <div className="mt-3 flex items-baseline gap-2">
          <input aria-label={`Amount of ${token.symbol}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="ui-figure min-w-0 flex-1 bg-transparent text-[40px] font-medium tracking-[-0.03em] outline-none" />
          <span className="text-[17px] font-semibold">{token.symbol}</span>
        </div>
        <details className="mt-2 text-[13px] text-ui-muted">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">Expires in {days || "7"} days</summary>
          <input aria-label="Days until the link expires" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(inputCls, "mt-2 rounded-full bg-ui-surface-2 px-4 py-2")} />
        </details>
      </Well>
      <div className="mt-3">
        {w.address ? (
          <PrimaryButton size="lg" block icon={<Link2 />} className="h-[58px] text-[17px]" disabled={!value || !!busy} loading={!!busy} onClick={create}>
            {busy ?? "Create pay link"}
          </PrimaryButton>
        ) : (
          <ConnectButton block large />
        )}
      </div>
      {err ? <p role="alert" className="px-3 pt-3 text-[13px] text-ui-down">{err}</p> : null}
      {link ? (
        <Done
          headline="Pay link ready"
          sub={<span className="inline-flex items-center gap-2">Anyone with it can claim {fmt(value ?? 0n, token.decimals)} {token.symbol} <CopyButton value={link.url} label="pay link" /></span>}
          details={<><span>{link.url.slice(0, 64)}…</span><span>Link #{link.id.toString()} · tx {short(link.tx, 6)}</span><span>The key is in the part after #, which browsers never send to a server</span>{encDetail()}</>}
        />
      ) : null}
    </>
  );
}

/** Opened a pay link: claim it into the connected wallet's private balance. */
function ClaimCard({ claim }: { claim: { token: Hex; id: bigint; key: Hex } }) {
  const w = useWallet();
  const { env, signer } = useConfidential();
  const token = env?.cfg.tokens.find((t) => t.address.toLowerCase() === claim.token.toLowerCase()) ?? null;
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Hex | null>(null);
  useEffect(() => {
    if (!env || !token) return;
    readPayLink(env, token, claim.id).then((l) => setState(l.state)).catch(() => setState("None"));
  }, [env, token, claim.id, done]);
  if (!env) return null;
  if (!token) return <Well className="mb-2"><p className="text-[14px] text-ui-warn">This link is for a token that isn&rsquo;t on this network.</p></Well>;

  async function go() {
    if (!env || !token || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const rc = await claimPayLink(env, await signer(), token, claim.id, claim.key);
      setDone(rc.transactionHash);
      history.replaceState(null, "", location.pathname);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className="mb-3">
      <Well>
        <div className="flex items-center gap-2 text-[13px] text-ui-muted"><Gift size={14} /> Pay link #{claim.id.toString()}</div>
        <div className="serif mt-2 text-[26px] leading-tight">{done ? "Claimed to your private balance" : state === "Open" ? `Someone sent you ${token.symbol}` : state ? `This link is ${state.toLowerCase()}` : "Checking the link…"}</div>
        <div className="mt-1 text-[13px] text-ui-muted">{done ? "Reveal it on the Balance tab" : "The amount is encrypted; only you will see it after claiming"}</div>
        {!done && state === "Open" ? (
          <div className="mt-4">{w.address ? <PrimaryButton size="lg" block loading={busy} onClick={go}>Claim</PrimaryButton> : <ConnectButton block large />}</div>
        ) : null}
        {err ? <p role="alert" className="pt-3 text-[13px] text-ui-down">{err}</p> : null}
      </Well>
    </GlassCard>
  );
}

// ------------------------------------------------------------------ page

export default function ConfidentialPage() {
  const { env, ready } = useConfidential();
  const [tab, setTab] = useState<"balance" | "pay" | "link">("balance");
  const [tokenAddr, setTokenAddr] = useState<Hex | null>(null);
  const [claim, setClaim] = useState<ReturnType<typeof parsePayLinkFragment>>(null);
  useEffect(() => setClaim(parsePayLinkFragment(location.hash)), []);

  // Threaded WASM needs cross-origin isolation, which only a document load of this route gets (its
  // COOP/COEP headers). Arriving by client-side navigation: reload once. Still not isolated after
  // that (Safari, Privy configured): stay, and encrypt single-threaded.
  useEffect(() => {
    try {
      if (isolated()) sessionStorage.removeItem(COI_RELOAD);
      else if (!sessionStorage.getItem(COI_RELOAD)) {
        sessionStorage.setItem(COI_RELOAD, "1");
        location.reload();
      }
    } catch {}
  }, []);

  const title = <ScreenTitle title="Hide how much" pill={<><Lock size={13} /> Kakushi Confidential</>} />;
  if (ready && !env) return <div className="mx-auto max-w-[500px] pt-[6vh]">{title}<NotLive /></div>;
  if (!env) return null;
  const tokens = env.cfg.tokens;
  const token = tokens.find((t) => t.address === tokenAddr) ?? tokens[0]!;

  return (
    <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[5vh]">
      {title}
      {claim ? <ClaimCard claim={claim} /> : null}
      <GlassCard>
        <div className="flex items-center justify-between px-1.5 pt-1 pb-3">
          <Segments value={tab} onChange={setTab} options={[{ id: "balance", label: "Balance" }, { id: "pay", label: "Pay" }, { id: "link", label: "Link" }]} />
          <TokenPicker tokens={tokens} value={token} onChange={(t) => setTokenAddr(t.address)} />
        </div>
        {tab === "balance" ? <BalanceTab key={token.address} token={token} /> : tab === "pay" ? <PayTab key={token.address} token={token} /> : <LinkTab key={token.address} token={token} />}
      </GlassCard>
      <details className="mt-4 px-2 text-[13px] text-ui-muted">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">How it works</summary>
        <div className="mt-2 grid gap-1.5 leading-relaxed">
          <span>Amounts are encrypted with fully homomorphic encryption (Zama tfhe-rs) in this tab, then the contract adds and subtracts them without decrypting.</span>
          <span>Private recipient adds Kakushi&rsquo;s stealth addresses: a fresh one-time address per payment, so the chain sees neither who nor how much.</span>
          <span>Only you can reveal your balance: one signature, the value comes back sealed to this tab.</span>
          <span>Cash out reveals only the amount you take out. <ArrowDownToLine size={12} className="inline" /></span>
          {!isolated() ? <span>This browser encrypts single-threaded (no cross-origin isolation), so encryption takes a little longer.</span> : null}
        </div>
      </details>
    </div>
  );
}
