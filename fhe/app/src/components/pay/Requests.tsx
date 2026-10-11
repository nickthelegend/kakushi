"use client";
// Payment requests (encrypted invoices): ask one payer for an amount only the two of you can read.
// What is still owed is itself a ciphertext, so even "was it paid?" is something only payee and
// payer learn, by decrypting requestDue with their own signature.
import { useCallback, useEffect, useState } from "react";
import type { Hex } from "viem";
import type { PayWallet, SentTx } from "@/lib/pay/wallet";
import { cancelRequest, listRequests, payRequest, requestMoney, reveal, type PayEnv, type PayRequestView } from "@/lib/pay/flows";
import { bytes32ToRef, fromUnits, short, toUnits } from "@/lib/pay/core";
import { Cipher, Revealed } from "@/components/ui";
import { Settlement } from "./Settlement";
import { addrOk, amountOk, Card, Input, Status, useAction } from "./PayKit";

type Reveals = Record<string, bigint>;
type SetReveals = (f: (r: Reveals) => Reveals) => void;

/** The shareable link: opens /pay focused on this request, ready for the payer. */
const linkFor = (id: bigint) => (typeof location === "undefined" ? `/pay?request=${id}` : `${location.origin}/pay?request=${id}`);

function CopyButton({ text, label = "Copy link", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className={className || "rounded-lg border border-kelp-strong px-3 py-1.5 text-xs font-semibold text-tide hover:bg-trench-2 hover:text-foam"}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function ShareBox({ id, amount }: { id: bigint; amount?: string }) {
  const url = linkFor(id);
  return (
    <div className="rounded-2xl border border-biolum/30 bg-biolum-soft p-4">
      <p className="text-sm font-semibold">
        Request #{id.toString()}
        {amount ? ` for ${amount} AUSD` : ""} is open
      </p>
      <div className="mt-2 flex gap-2">
        <input readOnly value={url} aria-label="Request link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-kelp bg-abyss px-2.5 py-2 font-mono text-xs text-foam" />
        <CopyButton text={url} label="Copy" className="rounded-lg bg-biolum px-3 text-sm font-semibold text-abyss" />
      </div>
      <p className="mt-2 text-xs text-tide">Send it to the payer. The link only carries the request number; the amount stays a ciphertext that opens for the two of you alone.</p>
    </div>
  );
}

// ------------------------------------------------------------------ create

export function RequestMoneyCard({ env, wallet, onCreated }: { env: PayEnv; wallet: PayWallet; onCreated: () => Promise<void> }) {
  const [payer, setPayer] = useState("");
  const [amt, setAmt] = useState("75");
  const [memo, setMemo] = useState("Rent, October");
  const [days, setDays] = useState("7");
  const [made, setMade] = useState<{ id: bigint; amount: string; tx: SentTx } | null>(null);
  const a = useAction();
  const self = addrOk(payer) && payer.trim().toLowerCase() === wallet.address.toLowerCase();
  const daysOk = Number(days) >= 1 && Number(days) <= 365;

  return (
    <Card title="Request money" sub="Ask one person for an amount only the two of you can read. They pay with one tap, and whether it has been paid stays between you as well.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMade(null);
          void a.run(async (step) => {
            const r = await requestMoney(env, wallet, payer.trim() as Hex, toUnits(amt), memo, Number(days), step);
            setMade({ id: r.id, amount: amt, tx: r.sent });
            await onCreated();
          });
        }}
      >
        <Input id="req-payer" label="Who should pay" value={payer} onChange={setPayer} mono placeholder="0x…" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="req-amount" label="Amount" value={amt} onChange={(v) => setAmt(v.replace(/[^\d.,]/g, ""))} inputMode="decimal" suffix="AUSD" />
          <Input id="req-ref" label="Public reference" value={memo} onChange={(v) => setMemo(v.slice(0, 31))} placeholder="Invoice 0042" />
          <Input id="req-days" label="Payable for (days)" value={days} onChange={(v) => setDays(v.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" />
        </div>
        {self && <p className="text-sm text-reef">That is your own address. Ask someone else.</p>}
        {memo && <p className="text-xs text-silt">The reference is public, so keep personal details out of it.</p>}
        <button type="submit" disabled={a.busy || !addrOk(payer) || self || !amountOk(amt) || !daysOk} className="w-full rounded-xl bg-biolum px-5 py-3 font-semibold text-abyss transition hover:brightness-110 disabled:opacity-50 sm:w-auto">
          {a.busy ? "Working…" : "Request privately"}
        </button>
        {wallet.sponsored && <span className="ml-3 text-xs text-sea-green">Gas sponsored</span>}
      </form>
      <Status step={a.step} error={a.error} />
      {made && <ShareBox id={made.id} amount={made.amount} />}
      {made && <Settlement tx={made.tx} client={env.client} network={env.network} label={`Request #${made.id} sent`} />}
    </Card>
  );
}

// ------------------------------------------------------------------ one request (row or focused view)

type ReqState = "open" | "paid" | "cancelled" | "expired";
function statusOf(v: PayRequestView, owed: bigint | undefined, chainNow: number): ReqState {
  if (v.cancelled) return "cancelled";
  if (owed === 0n) return "paid";
  if (chainNow > v.expiry) return "expired";
  return "open";
}
const CHIP: Record<ReqState, string> = {
  open: "bg-biolum-soft text-biolum",
  paid: "bg-sea-green/15 text-sea-green",
  cancelled: "bg-trench-2 text-tide",
  expired: "bg-trench-2 text-silt",
};
const CHIP_HINT: Record<ReqState, string> = {
  open: "Still payable. Whether anything is owed is encrypted.",
  paid: "Nothing left owed (only you and the other party can see this).",
  cancelled: "Cancelled by the requester.",
  expired: "Past its expiry: it can no longer be paid.",
};

function useRequestActions(env: PayEnv, wallet: PayWallet | null, v: PayRequestView, setRevealed: SetReveals, onChanged: () => Promise<void>) {
  const a = useAction();
  const [note, setNote] = useState<{ text: string; tone: "good" | "warn" | "plain" } | null>(null);
  const [tx, setTx] = useState<{ tx: SentTx; label: string } | null>(null);
  const merge = (r: Reveals) => setRevealed((cur) => ({ ...cur, ...r }));

  const revealOwed = () =>
    a.run(async (step) => {
      if (!wallet) return;
      step("Sign to read what is owed (EIP-712)…");
      merge(await reveal(env, wallet, [v.due]));
    });

  const pay = () =>
    a.run(async (step) => {
      if (!wallet) return;
      setNote(null);
      setTx(null);
      const r = await payRequest(env, wallet, v.id, step);
      setTx({ tx: r.sent, label: `Payment on request #${v.id}` });
      step("Sign to read what is still owed (EIP-712)…");
      const vals = await reveal(env, wallet, [r.before, r.after]);
      merge(vals);
      const before = vals[r.before.toLowerCase()];
      const after = vals[r.after.toLowerCase()];
      if (after === 0n) setNote({ tone: "good", text: before !== undefined && before > 0n ? `Paid in full: ${fromUnits(before)} AUSD moved privately. Nothing is owed now.` : "Nothing is owed on this request now." });
      else if (after !== undefined && after === before)
        setNote({ tone: "warn", text: `Your private balance was below ${fromUnits(after)} AUSD, so nothing moved (the contract never says why on-chain). The request stays open: top up and pay again.` });
      else if (after !== undefined) setNote({ tone: "plain", text: `${fromUnits(after)} AUSD is still owed.` });
      await onChanged();
    });

  const cancel = () =>
    a.run(async (step) => {
      if (!wallet) return;
      setNote(null);
      step("Cancelling the request…");
      const sent = await cancelRequest(env, wallet, v.id);
      setTx({ tx: sent, label: `Request #${v.id} cancelled` });
      setNote({ tone: "plain", text: `Request #${v.id} is cancelled and can no longer be paid.` });
      await onChanged();
    });

  return { a, note, tx, revealOwed, pay, cancel };
}

function Note({ note }: { note: { text: string; tone: "good" | "warn" | "plain" } | null }) {
  if (!note) return null;
  return (
    <p aria-live="polite" className={`text-sm ${note.tone === "good" ? "text-sea-green" : note.tone === "warn" ? "text-lantern" : "text-tide"}`}>
      {note.text}
    </p>
  );
}

function Owed({ v, owed }: { v: PayRequestView; owed: bigint | undefined }) {
  return owed === undefined ? <Cipher handle={v.due} /> : <Revealed>{fromUnits(owed)} AUSD</Revealed>;
}

function RequestRow({ env, wallet, v, revealed, setRevealed, chainNow, onChanged }: { env: PayEnv; wallet: PayWallet; v: PayRequestView; revealed: Reveals; setRevealed: SetReveals; chainNow: number; onChanged: () => Promise<void> }) {
  const me = wallet.address.toLowerCase();
  const iPay = v.payer.toLowerCase() === me;
  const owed = revealed[v.due.toLowerCase()];
  const st = statusOf(v, owed, chainNow);
  const ref = v.ref ? bytes32ToRef(v.ref) : "";
  const { a, note, tx, revealOwed, pay, cancel } = useRequestActions(env, wallet, v, setRevealed, onChanged);
  const live = st === "open";
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5">
        <span className="min-w-0">
          <span className="font-semibold">#{v.id.toString()}</span>
          <span className="text-tide"> {iPay ? "from" : "to"} <span className="whitespace-nowrap font-mono text-xs">{short(iPay ? v.payee : v.payer)}</span></span>
          {ref && <span className="ml-1.5 rounded bg-trench-2 px-1.5 py-0.5 text-xs text-tide">{ref}</span>}
        </span>
        <span className="text-right">
          <Owed v={v} owed={owed} />
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-x-2 text-[11px] text-silt">
          <span title={CHIP_HINT[st]} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[st]}`}>
            {st}
          </span>
          {v.payAttempts > 0 && <span>{v.payAttempts} pay attempt{v.payAttempts > 1 ? "s" : ""} ·</span>}
          <span>until {new Date(v.expiry * 1000).toLocaleDateString()}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {owed === undefined && (
          <button disabled={a.busy} onClick={() => void revealOwed()} className="rounded-lg bg-lantern px-3 py-1.5 text-xs font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
            Reveal owed
          </button>
        )}
        {iPay && live && (
          <button disabled={a.busy} onClick={() => void pay()} className="rounded-lg bg-biolum px-3 py-1.5 text-xs font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
            {a.busy ? "Working…" : owed !== undefined ? `Pay ${fromUnits(owed)}` : "Pay"}
          </button>
        )}
        {!iPay && live && (
          <>
            <CopyButton text={linkFor(v.id)} />
            <button disabled={a.busy} onClick={() => void cancel()} className="rounded-lg border border-reef/40 px-3 py-1.5 text-xs font-semibold text-reef hover:bg-reef/10 disabled:opacity-50">
              Cancel
            </button>
          </>
        )}
      </div>
      <Status step={a.step} error={a.error} />
      <Note note={note} />
      {tx && <Settlement tx={tx.tx} client={env.client} network={env.network} label={tx.label} />}
    </li>
  );
}

// ------------------------------------------------------------------ list

/** Requests for `who` (plus the one a shared link points at). Call reload() after anything that changes them. */
export function useRequests(env: PayEnv | null, who: Hex | null, focus: bigint | null) {
  const [items, setItems] = useState<PayRequestView[] | null>(null);
  const [chainNow, setChainNow] = useState(() => Math.floor(Date.now() / 1000));
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!env) return;
    const [list, block] = await Promise.all([listRequests(env, who ?? ("0x0000000000000000000000000000000000000000" as Hex), focus !== null ? [focus] : [], who !== null), env.client.getBlock()]);
    setItems(list);
    setChainNow(Number(block.timestamp));
    setErr(null);
  }, [env, who, focus]);
  useEffect(() => {
    let live = true;
    setItems(null); // a different account or link: never show the previous one's list
    load().catch((e) => live && setErr((e as Error).message.split("\n")[0]!));
    return () => {
      live = false;
    };
  }, [load]);
  return { items, chainNow, err, reload: load };
}

export function RequestsCard({ env, wallet, items, chainNow, err, revealed, setRevealed, onChanged }: { env: PayEnv; wallet: PayWallet; items: PayRequestView[] | null; chainNow: number; err: string | null; revealed: Reveals; setRevealed: SetReveals; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<"in" | "out">("in");
  const a = useAction();
  const me = wallet.address.toLowerCase();
  const toMe = (items ?? []).filter((v) => v.payer.toLowerCase() === me);
  const fromMe = (items ?? []).filter((v) => v.payee.toLowerCase() === me);
  const shown = tab === "in" ? toMe : fromMe;
  const hidden = shown.filter((v) => revealed[v.due.toLowerCase()] === undefined);
  const openToMe = toMe.filter((v) => !v.cancelled && chainNow <= v.expiry && revealed[v.due.toLowerCase()] !== 0n).length;
  return (
    <Card
      title="Requests"
      sub="Asked and asked of you, from cAUSD events. Who asked whom is public; the amount and whether it is still owed open only for the two of you."
      aside={
        <button
          disabled={a.busy || !hidden.length}
          onClick={() =>
            a.run(async (step) => {
              step("Sign to read what is owed (EIP-712)…");
              const r = await reveal(env, wallet, hidden.slice(0, 40).map((v) => v.due));
              setRevealed((cur) => ({ ...cur, ...r }));
            })
          }
          className="rounded-xl bg-lantern px-3.5 py-2 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-40"
        >
          {a.busy ? "Revealing…" : "Reveal owed"}
        </button>
      }
    >
      <div role="tablist" aria-label="Requests" className="inline-flex rounded-xl border border-kelp bg-abyss p-1">
        {(
          [
            ["in", `To me${openToMe ? ` · ${openToMe}` : ""}`],
            ["out", "Sent"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === k ? "bg-trench-2 text-foam" : "text-tide hover:text-foam"}`}>
            {l}
          </button>
        ))}
      </div>
      <Status step={a.step} error={a.error ?? err} />
      {items === null ? (
        <p className="text-sm text-silt">Reading the chain…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-silt">{tab === "in" ? `No one has asked ${short(wallet.address)} for money yet.` : "You have not asked anyone yet. Use Request money to send one."}</p>
      ) : (
        <ul className="-mr-2 max-h-[36rem] divide-y divide-kelp overflow-y-auto pr-2" aria-label={tab === "in" ? "Requests to me" : "Requests I sent"}>
          {shown.map((v) => (
            <RequestRow key={v.id.toString()} env={env} wallet={wallet} v={v} revealed={revealed} setRevealed={setRevealed} chainNow={chainNow} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ the shared link: /pay?request=<id>

export function RequestFocus({ env, wallet, id, v, loading, chainNow, revealed, setRevealed, onChanged }: { env: PayEnv; wallet: PayWallet | null; id: bigint; v: PayRequestView | undefined; loading: boolean; chainNow: number; revealed: Reveals; setRevealed: SetReveals; onChanged: () => Promise<void> }) {
  if (!v)
    return (
      <Card title={`Request #${id}`}>
        <p className="text-sm text-tide">{loading ? "Reading the request from the chain…" : `Request #${id} does not exist on this deployment. Check the link with whoever sent it.`}</p>
      </Card>
    );
  return <FocusBody env={env} wallet={wallet} v={v} chainNow={chainNow} revealed={revealed} setRevealed={setRevealed} onChanged={onChanged} />;
}

function FocusBody({ env, wallet, v, chainNow, revealed, setRevealed, onChanged }: { env: PayEnv; wallet: PayWallet | null; v: PayRequestView; chainNow: number; revealed: Reveals; setRevealed: SetReveals; onChanged: () => Promise<void> }) {
  const me = wallet?.address.toLowerCase();
  const role = !me ? "guest" : v.payer.toLowerCase() === me ? "payer" : v.payee.toLowerCase() === me ? "payee" : "other";
  const owed = revealed[v.due.toLowerCase()];
  const st = statusOf(v, owed, chainNow);
  const ref = v.ref ? bytes32ToRef(v.ref) : "";
  const { a, note, tx, revealOwed, pay, cancel } = useRequestActions(env, wallet, v, setRevealed, onChanged);
  const title = role === "payee" ? `You asked ${short(v.payer)}` : `${short(v.payee)} asks you to pay`;
  return (
    <section className="rounded-[22px] border border-biolum/30 bg-trench/80 p-5 backdrop-blur sm:p-6" aria-labelledby="req-focus">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-mono text-xs text-biolum">Request #{v.id.toString()}</p>
          <h2 id="req-focus" className="mt-1 font-display text-xl font-bold sm:text-2xl">
            {role === "guest" || role === "other" ? `${short(v.payee)} asked ${short(v.payer)}` : title}
          </h2>
          {ref && <p className="mt-1 text-sm text-tide">“{ref}”</p>}
        </div>
        <span title={CHIP_HINT[st]} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHIP[st]}`}>
          {st}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-biolum/25 bg-abyss/60 p-4">
          <dt className="text-xs uppercase tracking-wider text-silt">Owed · encrypted</dt>
          <dd className="mt-1 min-h-9">{owed === undefined ? <Cipher handle={v.due} /> : <span className="font-display text-2xl font-bold"><Revealed>{fromUnits(owed)}</Revealed></span>}</dd>
        </div>
        <div className="rounded-2xl border border-kelp bg-abyss/60 p-4 text-sm">
          <dt className="text-xs uppercase tracking-wider text-silt">Payable until</dt>
          <dd className="mt-1 text-tide">
            {new Date(v.expiry * 1000).toLocaleString()}
            {v.payAttempts > 0 && <span className="block text-xs text-silt">{v.payAttempts} pay attempt{v.payAttempts > 1 ? "s" : ""} so far</span>}
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-3">
        {role === "guest" && <p className="text-sm text-tide">Sign in as {short(v.payer)} to see the amount and pay it. Nobody else can open it, including this page.</p>}
        {role === "other" && <p className="text-sm text-lantern">This request is addressed to {short(v.payer)}, not to the account you are signed in with. Only that account (and the requester) can read or pay it.</p>}
        {(role === "payer" || role === "payee") && (
          <div className="flex flex-wrap gap-2">
            {owed === undefined && (
              <button disabled={a.busy} onClick={() => void revealOwed()} className="rounded-xl bg-lantern px-4 py-2.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
                {role === "payer" ? "Reveal the amount" : "Reveal what is owed"}
              </button>
            )}
            {role === "payer" && st === "open" && (
              <button disabled={a.busy} onClick={() => void pay()} className="rounded-xl bg-biolum px-5 py-2.5 text-sm font-semibold text-abyss hover:brightness-110 disabled:opacity-50">
                {a.busy ? "Working…" : owed !== undefined ? `Pay ${fromUnits(owed)} AUSD privately` : "Pay privately"}
              </button>
            )}
            {role === "payee" && st === "open" && (
              <>
                <CopyButton text={linkFor(v.id)} className="rounded-xl border border-kelp-strong px-4 py-2.5 text-sm font-semibold hover:bg-trench-2" />
                <button disabled={a.busy} onClick={() => void cancel()} className="rounded-xl border border-reef/40 px-4 py-2.5 text-sm font-semibold text-reef hover:bg-reef/10 disabled:opacity-50">
                  Cancel request
                </button>
              </>
            )}
          </div>
        )}
        {st === "paid" && !note && (role === "payer" || role === "payee") && <p className="text-sm text-sea-green">Nothing is owed on this request. Only you and {short(role === "payer" ? v.payee : v.payer)} can see that.</p>}
        {role === "payer" && st === "open" && <p className="text-xs text-silt">Paying moves exactly what is owed from your encrypted balance. If your balance is short, nothing moves and the request stays open; the chain never shows which.</p>}
        <Status step={a.step} error={a.error} />
        <Note note={note} />
        {tx && <Settlement tx={tx.tx} client={env.client} network={env.network} label={tx.label} />}
      </div>
    </section>
  );
}
