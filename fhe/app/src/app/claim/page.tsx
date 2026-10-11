"use client";
// Claim a pay link: /claim#id=<linkId>&k=<one-time key>. The fragment never reaches any server.

import Link from "next/link";
import { useEffect, useState } from "react";
import { parseEventLogs, type Hex } from "viem";
import { payAbi } from "@/lib/abi";
import { privateKeyToAccount } from "viem/accounts";
import { usePay, type SentTx } from "@/lib/pay/wallet";
import { balances, claimPayLink, readLink, reveal } from "@/lib/pay/flows";
import { fromUnits, short } from "@/lib/pay/core";
import { Cipher, Revealed } from "@/components/ui";
import { Settlement } from "@/components/pay/Settlement";
import { PrivyBanner, SignIn, Status, useAction, usePayEnv } from "@/components/pay/PayKit";

function parseFragment(): { id: bigint; key: Hex } | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const id = p.get("id");
  const k = p.get("k");
  if (!id || !/^\d+$/.test(id) || !k || !/^0x[0-9a-fA-F]{64}$/.test(k)) return null;
  return { id: BigInt(id), key: k as Hex };
}

export default function ClaimPage() {
  const pay = usePay();
  const env = usePayEnv();
  const w = pay.wallet;
  const [frag, setFrag] = useState<{ id: bigint; key: Hex } | null | undefined>(undefined);
  const [link, setLink] = useState<Awaited<ReturnType<typeof readLink>> | null>(null);
  const [tx, setTx] = useState<SentTx | null>(null);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const a = useAction();

  useEffect(() => {
    const read = () => setFrag(parseFragment());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!env || !frag) return;
    readLink(env, frag.id).then(setLink).catch(() => setLink(null));
  }, [env, frag, tx]);

  const keyMatches = link && frag ? privateKeyToAccount(frag.key).address.toLowerCase() === link.claimKey.toLowerCase() : false;
  const expired = link ? Number(link.expiry) * 1000 < Date.now() : false;

  return (
    <div className="mx-auto max-w-3xl px-5 pt-8 sm:pt-12">
      <p className="font-mono text-sm text-biolum">Fhish Pay · pay link</p>
      <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Someone sent you money.</h1>
      <p className="mt-3 max-w-2xl text-tide">The amount is sealed on Monad. Claim it to your own account; only you and the sender will ever be able to read how much it was.</p>
      <div className="mt-6">
        <PrivyBanner />
      </div>

      <div className="mt-8 space-y-6">
        {frag === undefined ? null : frag === null ? (
          <div className="rounded-[22px] border border-kelp p-6">
            <p className="font-semibold">This link is incomplete.</p>
            <p className="mt-1 text-sm text-tide">A pay link looks like /claim#id=12&amp;k=0x… . Ask the sender to copy it again, all the way to the end.</p>
            <Link href="/pay" className="mt-4 inline-block text-sm text-biolum hover:underline">Go to Fhish Pay</Link>
          </div>
        ) : (
          <section className="rounded-[22px] border border-kelp-strong bg-trench/80 p-6">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wider text-silt">Link</dt>
                <dd className="font-display text-xl font-bold">#{frag.id.toString()}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-silt">From</dt>
                <dd className="font-mono text-sm">{link ? short(link.sender) : "…"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-silt">Amount</dt>
                <dd>{amount !== null ? <Revealed>{fromUnits(amount)} AUSD</Revealed> : link ? <Cipher handle={link.amount} /> : "…"}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-tide" aria-live="polite">
              {!link
                ? "Reading the link…"
                : link.state === "None"
                  ? "No such link on this network."
                  : link.state === "Claimed"
                    ? tx
                      ? "Claimed to your account."
                      : "This link was already claimed."
                    : link.state === "Refunded"
                      ? "The sender took this one back after it expired."
                      : !keyMatches
                        ? "The key in this link does not match. It may have been cut off."
                        : expired
                          ? "This link has expired; the sender can refund it."
                          : `Open until ${new Date(Number(link.expiry) * 1000).toLocaleString()}.`}
            </p>
          </section>
        )}

        {frag && link?.state === "Open" && keyMatches && !expired && !tx && (
          <>
            {!w ? (
              <SignIn why="Create your account to claim it. You will not need any crypto or gas." guestFirst />
            ) : (
              <section className="rounded-[22px] border border-kelp bg-trench/70 p-6">
                <p className="text-sm text-tide">
                  Claiming to <span className="font-semibold text-foam">{w.label}</span> <span className="font-mono text-xs">{short(w.address)}</span>. The link key signs your address, so nobody can redirect it, and the claim is {w.kind === "privy" ? (w.sponsored ? "gas-sponsored by Privy" : "signed by your Privy wallet") : "submitted by the fork's sponsor (you pay no gas)"}.
                </p>
                <button
                  disabled={a.busy || !env}
                  onClick={() =>
                    void a.run(async (step) => {
                      step("Signing the claim with the link key and submitting…");
                      const sent = await claimPayLink(env!, w, frag.id, frag.key);
                      setTx(sent);
                      // drop the key from the address bar and history once it is spent
                      history.replaceState(null, "", `/claim#id=${frag.id}`);
                    })
                  }
                  className="mt-4 rounded-xl bg-biolum px-6 py-3 font-semibold text-abyss hover:brightness-110 disabled:opacity-50"
                >
                  {a.busy ? "Claiming…" : "Claim it"}
                </button>
                <div className="mt-3">
                  <Status step={a.step} error={a.error} />
                </div>
              </section>
            )}
          </>
        )}

        {tx && env && w && (
          <section className="space-y-4 rounded-[22px] border border-kelp bg-trench/70 p-6">
            <Settlement tx={tx} client={env.client} network={env.network} label="Claimed" />
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={a.busy}
                onClick={() =>
                  void a.run(async (step) => {
                    step("Sign to read what you received (EIP-712)…");
                    const bal = await balances(env, w.address);
                    // the claim moved the escrow into a fresh handle that you (not the escrow) may read
                    const got = parseEventLogs({ abi: payAbi, logs: tx.receipt.logs, eventName: "ConfidentialTransfer" }).find((l) => l.args.to.toLowerCase() === w.address.toLowerCase());
                    const hs = [bal.handle, ...(got ? [got.args.amount as Hex] : [])];
                    const r = await reveal(env, w, hs);
                    setAmount(got ? (r[(got.args.amount as Hex).toLowerCase()] ?? null) : null);
                    setBalance(r[bal.handle.toLowerCase()] ?? null);
                  })
                }
                className="rounded-xl bg-lantern px-5 py-2.5 font-semibold text-abyss hover:brightness-110 disabled:opacity-50"
              >
                Reveal what I received
              </button>
              {balance !== null && (
                <span className="text-sm">
                  Your private balance: <Revealed>{fromUnits(balance)} cAUSD</Revealed>
                </span>
              )}
            </div>
            <Status step={a.step} error={a.error} />
            <p className="text-sm text-tide">
              It is yours now. <Link href="/pay" className="text-biolum hover:underline">Open Fhish Pay</Link> to send it on, or cash it out to AUSD.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
