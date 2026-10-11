// Pay links. The one-time claim key travels ONLY in the URL fragment (#k=...): fragments are never
// sent to a server, and the app never logs or uploads the key.
//   kakushipay://claim?net=local&id=7#k=0x...
//   https://<LINK_HOST>/claim?net=local&id=7#k=0x...   (opens the app via associated domains)
import { LINK_HOST, type NetworkId } from "./config.ts";
import type { Hex } from "./bytes.ts";

export interface ParsedLink {
  net: NetworkId;
  id: bigint;
  key: Hex;
}

export function linkUrls(net: NetworkId, id: bigint, key: Hex) {
  const q = `net=${net}&id=${id}#k=${key}`;
  return { app: `kakushipay://claim?${q}`, web: `https://${LINK_HOST}/claim?${q}` };
}

export function parseLink(url: string): ParsedLink | null {
  const m = url.trim().match(/^(?:kakushipay:\/\/|https?:\/\/[^/]+\/)claim\/?\?([^#]*)#(.*)$/i);
  if (!m) return null;
  const q = new Map(m[1]!.split("&").map((kv) => kv.split("=") as [string, string]));
  const f = new Map(m[2]!.split("&").map((kv) => kv.split("=") as [string, string]));
  const net = q.get("net");
  const id = q.get("id");
  const key = f.get("k");
  if ((net !== "local" && net !== "testnet") || !id || !/^\d+$/.test(id) || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return { net, id: BigInt(id), key: key as Hex };
}

// Request links ("Request money"). A request needs no secret: only its payer can pay it and only
// the payee and payer can decrypt the amount, so the link just points at the on-chain request.
// The readable memo rides in the fragment (never sent to a server); on-chain it is only a hash, which
// the app checks against the request's PaymentRequested event at block `b`.
//   kakushipay://request?net=local&id=3&b=69540400#m=rent
//   https://<LINK_HOST>/request?net=local&id=3&b=69540400#m=rent
export interface ParsedRequestLink {
  net: NetworkId;
  id: bigint;
  /** block of the PaymentRequested event (lets the app verify the memo with one log query) */
  block?: bigint;
  memo?: string;
}

export function requestUrls(net: NetworkId, id: bigint, block?: bigint, memo?: string) {
  const q = `net=${net}&id=${id}${block !== undefined ? `&b=${block}` : ""}${memo?.trim() ? `#m=${encodeURIComponent(memo.trim())}` : ""}`;
  return { app: `kakushipay://request?${q}`, web: `https://${LINK_HOST}/request?${q}` };
}

export function parseRequestLink(url: string): ParsedRequestLink | null {
  const m = url.trim().match(/^(?:kakushipay:\/\/|https?:\/\/[^/]+\/)request\/?\?([^#]*)(?:#(.*))?$/i);
  if (!m) return null;
  const q = new Map(m[1]!.split("&").map((kv) => kv.split("=") as [string, string]));
  const f = new Map((m[2] ?? "").split("&").filter(Boolean).map((kv) => kv.split("=") as [string, string]));
  const net = q.get("net");
  const id = q.get("id");
  const b = q.get("b");
  if ((net !== "local" && net !== "testnet") || !id || !/^\d+$/.test(id) || (b !== undefined && !/^\d+$/.test(b))) return null;
  let memo: string | undefined;
  try {
    memo = f.get("m") !== undefined ? decodeURIComponent(f.get("m")!).slice(0, 120) : undefined;
  } catch {
    memo = undefined;
  }
  return { net, id: BigInt(id), block: b !== undefined ? BigInt(b) : undefined, memo };
}
