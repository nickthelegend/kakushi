"use client";
// One shared monadNewHeads subscription per tab (Monad testnet, read-only). Used by the heartbeat
// and, when the app runs against Monad testnet itself, by the settlement ladder.
import { MonadHeads } from "@kakushi/fhe-sdk/monad";

export const MONAD_WSS = process.env.NEXT_PUBLIC_MONAD_WSS || "wss://testnet-rpc.monad.xyz";

let shared: MonadHeads | null = null;
let starting: Promise<MonadHeads> | null = null;
let users = 0;

export function acquireHeads(): Promise<MonadHeads> {
  users++;
  if (shared) return Promise.resolve(shared);
  starting ??= (async () => {
    const h = new MonadHeads(MONAD_WSS);
    try {
      await h.start();
    } catch (e) {
      starting = null;
      throw e;
    }
    shared = h;
    return h;
  })();
  return starting;
}

export function releaseHeads() {
  users = Math.max(0, users - 1);
  if (users === 0 && shared) {
    shared.stop();
    shared = null;
    starting = null;
  }
}

/** Drop a stalled socket so the next acquireHeads() reconnects (listeners must re-subscribe). */
export function resetHeads() {
  shared?.stop();
  shared = null;
  starting = null;
}
