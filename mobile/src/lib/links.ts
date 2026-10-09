// Pay links. The one-time claim key travels ONLY in the URL fragment (#k=...): fragments are never
// sent to a server, and the app never logs or uploads the key.
//   fhishpay://claim?net=local&id=7#k=0x...
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
  return { app: `fhishpay://claim?${q}`, web: `https://${LINK_HOST}/claim?${q}` };
}

export function parseLink(url: string): ParsedLink | null {
  const m = url.trim().match(/^(?:fhishpay:\/\/|https?:\/\/[^/]+\/)claim\/?\?([^#]*)#(.*)$/i);
  if (!m) return null;
  const q = new Map(m[1]!.split("&").map((kv) => kv.split("=") as [string, string]));
  const f = new Map(m[2]!.split("&").map((kv) => kv.split("=") as [string, string]));
  const net = q.get("net");
  const id = q.get("id");
  const key = f.get("k");
  if ((net !== "local" && net !== "testnet") || !id || !/^\d+$/.test(id) || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return { net, id: BigInt(id), key: key as Hex };
}
