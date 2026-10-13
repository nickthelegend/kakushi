"use client";

import { CopyButton, Menu, PrimaryButton, cn } from "@kakushi/ui";
import { Check, ChevronDown, Eye, EyeOff, Gift, Link2, Lock, LockOpen, Send } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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

/** A small two-way toggle inside a well (Make private / Cash out, Private recipient / Address). */
function Segments<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-white/[0.04] p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={cn("rounded-full px-3 py-1 text-[13px] font-medium transition-colors", value === o.id ? "bg-ui-surface-3 text-ui-text" : "text-ui-muted hover:text-ui-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type TabId = "balance" | "pay" | "link";
const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "balance", label: "Balance", icon: <Lock size={14} /> },
  { id: "pay", label: "Pay", icon: <Send size={14} /> },
  { id: "link", label: "Link", icon: <Link2 size={14} /> },
];

/** The card's main switch: one clear selected state, so it never reads like the toggles inside. */
function TabBar({ value, onChange }: { value: TabId; onChange: (v: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Confidential" className="flex min-w-0 flex-1 gap-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-colors sm:px-4", value === t.id ? "bg-[#2f47f5] text-white" : "text-ui-muted hover:bg-white/[0.04] hover:text-ui-text")}
        >
          <span aria-hidden className="hidden sm:inline-flex">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 text-[13px] text-ui-muted">{children}</div>;
}

function AmountInput({ label, value, onChange, unit, size = 40 }: { label: string; value: string; onChange: (v: string) => void; unit: string; size?: number }) {
  return (
    <div className="mt-3 flex items-baseline gap-2">
      <input aria-label={label} inputMode="decimal" placeholder="0" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} style={{ fontSize: size }} className="ui-figure min-w-0 flex-1 bg-transparent font-medium tracking-[-0.03em] outline-none placeholder:text-ui-dim" />
      <span className="text-[17px] font-semibold">{unit}</span>
    </div>
  );
}

function encDetail() {
  return lastEncryption.ms ? <span>Encrypted in your browser in {lastEncryption.ms} ms</span> : null;
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
        setDone({ headline: `${fmt(value, token.decimals)} ${token.underlyingSymbol} is now private`, sub: "From here on, only you can see how much you hold", details: [`Tx ${short(rc.transactionHash, 6)}`, "The deposit is public; every move after it is encrypted"] });
      } else {
        const out = await unwrap(env, s, token, value, setBusy);
        setDone({
          headline: out.released > 0n ? `Cashed out ${fmt(out.released, token.decimals)} ${token.underlyingSymbol}` : "Nothing cashed out",
          sub: out.released > 0n ? "Only this amount was ever revealed" : "Your private balance was lower than that amount",
          details: [`Tx ${short(out.receipt.transactionHash, 6)}`, `Decryption request #${out.requestId}`],
        });
      }
      setPriv(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const fill = mode === "in" ? pub : priv;
  const unit = mode === "in" ? token.underlyingSymbol : token.symbol;

  return (
    <>
      <Well>
        <Caption>
          <span>Private balance</span>
          {w.address ? (
            <button type="button" onClick={doReveal} disabled={revealing} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ui-surface-2 px-3 font-medium text-ui-text hover:bg-ui-surface-3 disabled:opacity-60">
              {priv === null ? <Eye size={14} /> : <EyeOff size={14} />} {revealing ? "Revealing…" : priv === null ? "Reveal" : "Refresh"}
            </button>
          ) : null}
        </Caption>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={cn("ui-figure text-[40px] font-medium tracking-[-0.03em]", priv === null && "text-ui-dim")}>{priv === null ? "••••••" : fmt(priv, token.decimals)}</span>
          <span className="text-[17px] font-semibold">{token.symbol}</span>
        </div>
        <div className="mt-1 text-[13px] text-ui-muted">{!w.address ? "Connect a wallet to see yours" : priv === null ? "Hidden on-chain. Reveal takes one signature." : "Visible in this tab only"}</div>
      </Well>
      <Well className="mt-2">
        <Caption>
          <Segments value={mode} onChange={(m) => { setMode(m); setDone(null); }} options={[{ id: "in", label: "Make private" }, { id: "out", label: "Cash out" }]} />
          {fill !== null ? (
            <button type="button" onClick={() => setAmount(formatUnits(fill, token.decimals))} className="ui-figure hover:text-ui-text">
              {mode === "in" ? token.underlyingSymbol : "Private"} {fmt(fill, token.decimals)} <span className="ml-1 font-semibold text-ui-lime-text">Max</span>
            </button>
          ) : null}
        </Caption>
        <AmountInput label={`Amount of ${unit}`} value={amount} onChange={setAmount} unit={unit} />
      </Well>
      <div className="mt-3">
        {w.address ? (
          <PrimaryButton size="lg" block icon={mode === "in" ? <Lock /> : <LockOpen />} className="h-[58px] text-[17px]" disabled={!value || !!busy} loading={!!busy} onClick={act}>
            {busy ?? (mode === "in" ? `Make ${token.underlyingSymbol} private` : `Cash out to ${token.underlyingSymbol}`)}
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
          details: [`Tx ${short(r.receipt.transactionHash, 6)}`, `One-time address ${short(r.stealthAddress, 6)}`, `Includes ${formatEther(r.gas)} MON so they can move it`],
        });
      } else {
        const r = await payEncrypted(env, s, token, to.trim() as Hex, value, stringToHex("kakushi", { size: 32 }), setBusy);
        setDone({ headline: `Sent ${fmt(value, token.decimals)} ${token.symbol}`, sub: `Only you and ${short(to.trim())} can see how much`, details: [`Tx ${short(r.receipt.transactionHash, 6)}`, ...(r.sent ? [`On-chain amount: ciphertext ${short(r.sent, 8)}`] : [])] });
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
        <Caption>
          <Segments value={privateTo ? "p" : "a"} onChange={(v) => { setPrivateTo(v === "p"); setDone(null); }} options={[{ id: "p", label: "Private recipient" }, { id: "a", label: "Address" }]} />
          {privateTo && meta ? <span className="inline-flex items-center gap-1 text-[#c4d0ff]"><Check size={13} /> {resolved && "via" in resolved && resolved.via === "registry" ? "Private receiving on" : "Meta-address"}</span> : null}
        </Caption>
        <input aria-label={privateTo ? "Recipient meta-address or wallet" : "Recipient address"} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder={privateTo ? "Wallet (0x…) or meta-address (st:eth:0x…)" : "Wallet address (0x…)"} className={cn(inputCls, "mt-3 rounded-full bg-ui-surface-2 px-4 py-3 font-mono text-[13px]")} />
        <p className={cn("mt-2 px-1 text-[13px]", resolved && "error" in resolved ? "text-ui-warn" : "text-ui-muted")}>
          {resolved && "error" in resolved ? resolved.error : privateTo ? "Hides who gets paid and how much" : "Hides how much; the recipient is public"}
        </p>
      </Well>
      <Well className="mt-2">
        <Caption><span>Amount</span><span className="inline-flex items-center gap-1"><Lock size={12} /> Encrypted in your browser</span></Caption>
        <AmountInput label={`Amount of ${token.symbol}`} value={amount} onChange={setAmount} unit={token.symbol} />
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
        <Caption><span>Amount</span><span className="inline-flex items-center gap-1"><Lock size={12} /> Held encrypted until claimed</span></Caption>
        <AmountInput label={`Amount of ${token.symbol}`} value={amount} onChange={setAmount} unit={token.symbol} />
      </Well>
      <Well className="mt-2 py-3.5">
        <Caption>
          <span>Expires in</span>
          <Segments value={days} onChange={setDays} options={[{ id: "1", label: "1 day" }, { id: "7", label: "7 days" }, { id: "30", label: "30 days" }]} />
        </Caption>
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
          sub={
            <>
              <span>Anyone with this link can claim it. Share it privately.</span>
              <span className="mt-3 flex items-center gap-2 rounded-full bg-[#04060f]/80 py-1.5 pr-1.5 pl-4 ring-1 ring-white/[0.06]">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ui-text">{link.url}</span>
                <CopyButton value={link.url} label="pay link" />
              </span>
            </>
          }
          details={<><span>Link #{link.id.toString()} · tx {short(link.tx, 6)}</span><span>The key sits after the #, which browsers never send to a server</span>{encDetail()}</>}
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
        <div className="mt-1 text-[13px] text-ui-muted">{done ? "Reveal it on the Balance tab" : "The amount stays hidden; only you can reveal it after claiming"}</div>
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
  const [tab, setTab] = useState<TabId>("balance");
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
  if (!env)
    return (
      <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[5vh]">
        {title}
        <GlassCard>
          <div aria-busy className="grid gap-2" aria-label="Loading">
            <div className="h-9 w-56 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="h-[140px] animate-pulse rounded-[22px] bg-[#04060f]/80" />
            <div className="h-[118px] animate-pulse rounded-[22px] bg-[#04060f]/80" />
            <div className="mt-1 h-[58px] animate-pulse rounded-full bg-white/[0.04]" />
          </div>
        </GlassCard>
      </div>
    );
  const tokens = env.cfg.tokens;
  const token = tokens.find((t) => t.address === tokenAddr) ?? tokens[0]!;

  return (
    <div className="mx-auto w-full max-w-[500px] pt-6 pb-20 sm:pt-[5vh]">
      {title}
      {claim ? <ClaimCard claim={claim} /> : null}
      <GlassCard>
        <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-3">
          <TabBar value={tab} onChange={setTab} />
          <TokenPicker tokens={tokens} value={token} onChange={(t) => setTokenAddr(t.address)} />
        </div>
        {tab === "balance" ? <BalanceTab key={token.address} token={token} /> : tab === "pay" ? <PayTab key={token.address} token={token} /> : <LinkTab key={token.address} token={token} />}
      </GlassCard>
      <details className="group mt-4 px-3 text-[13px] text-ui-muted">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-ui-text [&::-webkit-details-marker]:hidden">
          How it works <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-2 grid gap-1.5 leading-relaxed">
          <li>Amounts are encrypted in your browser (FHE). The contract adds and subtracts them without ever decrypting.</li>
          <li>Private recipient also sends to a fresh one-time address, so nobody sees who got paid.</li>
          <li>Only you can reveal your balance. Cash out reveals only the amount you take out.</li>
          {!isolated() ? <li>This browser encrypts on one thread, so it takes a little longer.</li> : null}
        </ul>
      </details>
    </div>
  );
}
