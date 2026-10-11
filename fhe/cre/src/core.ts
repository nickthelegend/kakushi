// Pure logic shared by the CRE workflow (compiled to WASM) and the local runner (Node):
// parse the gateway's KMS-signed decryption result, make a canonical form the DON can agree
// on byte-for-byte, and encode the report KakushiDecryptionOracle.onReport expects.
import { encodeAbiParameters, type Hex, keccak256, toHex } from "viem";

export const DECRYPTION_REQUESTED = keccak256(toHex("DecryptionRequested(uint256,address,bytes32[],bytes4)"));

export interface SignedResult {
  requestId: bigint;
  handles: Hex[];
  cleartexts: bigint[];
  signatures: Hex[];
}

const isHex = (s: unknown, bytes?: number): s is Hex =>
  typeof s === "string" && /^0x[0-9a-fA-F]*$/.test(s) && (bytes === undefined || s.length === 2 + bytes * 2);

/** Parse GET /decryptions/:id. Throws on anything malformed so a node never agrees on garbage. */
export function parseResult(body: string, requestId: bigint): SignedResult {
  const j = JSON.parse(body) as { requestId?: unknown; handles?: unknown; cleartexts?: unknown; signatures?: unknown };
  if (String(j.requestId) !== requestId.toString()) throw new Error(`result is for request ${String(j.requestId)}, not ${requestId}`);
  if (!Array.isArray(j.handles) || !j.handles.every((h) => isHex(h, 32))) throw new Error("bad handles");
  if (!Array.isArray(j.cleartexts) || j.cleartexts.length !== j.handles.length) throw new Error("bad cleartexts");
  if (!j.cleartexts.every((c) => typeof c === "string" && /^\d+$/.test(c))) throw new Error("bad cleartexts");
  if (!Array.isArray(j.signatures) || j.signatures.length === 0 || !j.signatures.every((s) => isHex(s, 65))) throw new Error("bad signatures");
  return {
    requestId,
    handles: j.handles as Hex[],
    cleartexts: (j.cleartexts as string[]).map((c) => BigInt(c)),
    signatures: (j.signatures as Hex[]).map((s) => s.toLowerCase() as Hex),
  };
}

/** Deterministic string every honest node produces for the same result (consensus input). */
export function canonical(r: SignedResult): string {
  return [r.requestId.toString(), r.handles.map((h) => h.toLowerCase()).join(","), r.cleartexts.join(","), r.signatures.join(",")].join("|");
}

export function fromCanonical(s: string): SignedResult {
  const [id, handles, clear, sigs] = s.split("|");
  if (id === undefined || handles === undefined || clear === undefined || sigs === undefined) throw new Error("bad canonical result");
  return {
    requestId: BigInt(id),
    handles: handles ? (handles.split(",") as Hex[]) : [],
    cleartexts: clear ? clear.split(",").map((c) => BigInt(c)) : [],
    signatures: sigs ? (sigs.split(",") as Hex[]) : [],
  };
}

/** report = abi.encode(uint256 requestId, uint256[] cleartexts, bytes[] signatures) */
export function encodeReport(r: SignedResult): Hex {
  return encodeAbiParameters([{ type: "uint256" }, { type: "uint256[]" }, { type: "bytes[]" }], [r.requestId, r.cleartexts, r.signatures]);
}

/** The request id is the first indexed topic of DecryptionRequested. */
export function requestIdFromTopics(topics: Hex[]): bigint {
  if (topics[0]?.toLowerCase() !== DECRYPTION_REQUESTED) throw new Error("not a DecryptionRequested log");
  if (!topics[1]) throw new Error("missing requestId topic");
  return BigInt(topics[1]);
}

/** Which recent requests a cron sweep should look at: the newest `max`, newest first. */
export function sweepIds(nextRequestId: bigint, max: number): bigint[] {
  const out: bigint[] = [];
  for (let id = nextRequestId - 1n; id >= 1n && out.length < max; id--) out.push(id);
  return out;
}

/** Marker values a node returns instead of a result (they are agreed on like any other string). */
export const PENDING = "PENDING";
export const isMarker = (s: string) => s === PENDING || s.startsWith("ERR:");
