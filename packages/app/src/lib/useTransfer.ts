"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { chainById } from "@kakushi/config";
import { toHex32 } from "@kakushi/attest-core";
import { blockBefore, findPayout, findSourcePayments, srcRefOf, type Classification, type PayoutSeen, type SourcePayment } from "@kakushi/sdk";
import { useRuntime } from "./runtime";

export interface WatchRow {
  status: string;
  note: string | null;
  disputeKey: string | null;
  openTx: string | null;
  proveTx: string | null;
  proofMs: number | null;
}

export interface TransferView {
  payment: SourcePayment | null;
  c: Classification | null;
  srcRef: Hex | null;
  deadline: bigint | null;
  payout: PayoutSeen | null;
  coveredUntil: bigint | null;
  watch: WatchRow | null;
  dispute: { status: number; settled: boolean; key: Hex } | null;
  notFound: boolean;
  error: string | null;
  now: number;
}

export function useTransfer(chainId: number, hash: Hex, logIndex?: number): TransferView {
  const { k } = useRuntime();
  const identity = useMemo(() => ({}), [k, chainId, hash, logIndex]);
  const empty = (): TransferView => ({ payment: null, c: null, srcRef: null, deadline: null, payout: null, coveredUntil: null, watch: null, dispute: null, notFound: false, error: null, now: Date.now() });
  const [state, setState] = useState<{ identity: object; view: TransferView } | null>(null);
  const setV = (update: TransferView | ((view: TransferView) => TransferView)) => setState((old) => ({ identity, view: typeof update === "function" ? update(old?.identity === identity ? old.view : empty()) : update }));
  useEffect(() => {
    if (!k) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let payment: SourcePayment | null = null;
    let c: Classification | null = null;
    let fromBlock: bigint | null = null;
    let payout: PayoutSeen | null = null;
    let misses = 0;
    const tick = async () => {
      try {
        if (!payment) {
          const sources = await findSourcePayments(k, chainId, hash);
          payment = (logIndex === undefined ? sources[0] : sources.find((p) => p.logIndex === logIndex)) ?? null;
          if (!payment) {
            misses++;
            if (live) setV((x) => ({ ...x, notFound: misses > 3, now: Date.now() }));
            return;
          }
        }
        if (!c) c = await k.classify(payment.maker, payment.srcChainId, payment.token, payment.gross, payment.timestamp);
        const srcRef = srcRefOf(payment);
        const deadline = payment.timestamp + k.fillWindow;
        let coveredUntil: bigint | null = null;
        if (c && c.kind !== 0) {
          const ob = k.clientById(c.obligationChainId);
          if (fromBlock === null) fromBlock = await blockBefore(ob, payment.timestamp - k.clockSkew, chainById(c.obligationChainId).blockTimeMs);
          if (!payout) payout = await findPayout(ob, k.d.chains[c.obligationChainId]!.payoutRouter, srcRef, payment.maker, fromBlock);
          coveredUntil = await k.payoutCoveredUntil(c.obligationChainId);
        }
        let watch: WatchRow | null = null;
        try {
          const r = await fetch(`/api/svc/watchtower/watched?srcRef=${toHex32(srcRef)}`);
          if (r.ok) {
            const rows = (await r.json()) as (WatchRow & { maker: string })[];
            watch = rows.find((x) => x.maker === payment!.maker.toLowerCase()) ?? null;
          }
        } catch {}
        const key = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [toHex32(srcRef), payment.maker]));
        const d = await k.dispute(key);
        if (live) setV({ payment, c, srcRef: toHex32(srcRef), deadline, payout, coveredUntil, watch, dispute: { status: d.status, settled: d.settled, key }, notFound: false, error: null, now: Date.now() });
      } catch (e) {
        if (live) setV((x) => ({ ...x, error: (e as Error).message.split("\n")[0]!, now: Date.now() }));
      } finally {
        if (live) timer = setTimeout(tick, 1500);
      }
    };
    void tick();

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [k, chainId, hash, logIndex]);
  return state?.identity === identity ? state.view : empty();
}
