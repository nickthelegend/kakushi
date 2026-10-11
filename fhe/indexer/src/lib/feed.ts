// The activity feed wallets render: one FeedItem per Kakushi Pay event per account it involves.
// Mirrors mobile/src/lib/pay.ts activity() one-to-one, so a client gets its whole history in one
// query instead of scanning eth_getLogs (100 blocks per call on Monad).
// Amounts are ciphertext handles; only wraps and settled cash-outs carry a public amount.
import type { FeedItem } from "envio";
import { lc } from "./common";

export type FeedKind =
  | "sent"
  | "received"
  | "link-created"
  | "link-received"
  | "link-claimed"
  | "link-refunded"
  | "wrapped"
  | "cashout-requested"
  | "cashed-out"
  | "request-sent"
  | "request-received"
  | "request-paid"
  | "request-cancelled";

interface Ev {
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: { number: number };
  transaction: { hash: string };
}

export function feed(
  ctx: { FeedItem: { set: (f: FeedItem) => void } },
  e: Ev,
  account: string,
  kind: FeedKind,
  f: { counterparty?: string; handle?: string; amount?: bigint; linkId?: bigint; requestId?: bigint; role?: "payee" | "payer"; ref?: string } = {},
) {
  ctx.FeedItem.set({
    id: `${e.chainId}-${lc(e.transaction.hash)}-${e.logIndex}-${lc(account)}`,
    chainId: e.chainId,
    token: lc(e.srcAddress),
    account: lc(account),
    kind,
    counterparty: f.counterparty ? lc(f.counterparty) : undefined,
    handle: f.handle ? lc(f.handle) : undefined,
    amount: f.amount,
    linkId: f.linkId,
    requestId: f.requestId,
    role: f.role,
    ref: f.ref ? lc(f.ref) : undefined,
    blockNumber: e.block.number,
    logIndex: e.logIndex,
    txHash: lc(e.transaction.hash),
  });
}
