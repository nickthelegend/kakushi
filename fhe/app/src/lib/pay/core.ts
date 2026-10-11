// Fhish Pay: shared, isomorphic helpers (browser and API routes).
import { defineChain, formatUnits, hexToString, parseAbi, parseUnits, stringToHex, type Hex } from "viem";

export const MONAD_TESTNET_ID = 10143;
export const DECIMALS = 6; // AUSD and USDC

export function payChain(rpc: string, local: boolean) {
  return defineChain({
    id: MONAD_TESTNET_ID,
    name: local ? "Monad testnet (local fork)" : "Monad testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Monad explorer", url: "https://testnet.monadexplorer.com" } },
  });
}

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

/** Agora's AUSD faucet on Monad testnet: requestFunds(address) -> 10,000 AUSD (60 s global cooldown). */
export const AUSD_FAUCET: Hex = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
export const faucetAbi = parseAbi(["function requestFunds(address)"]);

/** Monad bills the gas limit, not gas used: always send an explicit limit of estimate x 1.3. */
export const withBuffer = (estimate: bigint) => (estimate * 13n) / 10n;

export const toUnits = (v: string) => parseUnits((v || "0").replace(/,/g, "").trim() || "0", DECIMALS);
export const fromUnits = (v: bigint) => Number(formatUnits(v, DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** A public reference (invoice id, memo) as bytes32. Keep it short: it is public. */
export const refToBytes32 = (s: string): Hex => stringToHex(s.slice(0, 31), { size: 32 });
export function bytes32ToRef(h: Hex): string {
  if (/^0x0+$/.test(h)) return "";
  try {
    const s = hexToString(h, { size: 32 }).replace(/\0+$/, "");
    return /^[\x20-\x7e]+$/.test(s) ? s : `${h.slice(0, 10)}…`;
  } catch {
    return `${h.slice(0, 10)}…`;
  }
}

export const isZeroHandle = (h: Hex | null | undefined) => !h || /^0x0+$/.test(h);
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** EIP-712 batch authorization: the employer signs the exact encrypted batch the operator may submit. */
export function payrollBatchTypedData(p: { chainId: number; token: Hex; employer: Hex; operator: Hex; to: Hex[]; amounts: Hex[]; ref: Hex; deadline: bigint }) {
  return {
    domain: { name: "Fhish Payroll", version: "1", chainId: p.chainId, verifyingContract: p.token },
    types: {
      PayrollBatch: [
        { name: "employer", type: "address" },
        { name: "operator", type: "address" },
        { name: "to", type: "address[]" },
        { name: "amounts", type: "bytes32[]" },
        { name: "ref", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "PayrollBatch" as const,
    message: { employer: p.employer, operator: p.operator, to: p.to, amounts: p.amounts, ref: p.ref, deadline: p.deadline },
  };
}

/** ERC-2612 permit typed data (AUSD: domain "Agora Dollar", version "1", read via EIP-5267). */
export function permitTypedData(p: { chainId: number; token: Hex; tokenName: string; tokenVersion: string; owner: Hex; spender: Hex; value: bigint; nonce: bigint; deadline: bigint }) {
  return {
    domain: { name: p.tokenName, version: p.tokenVersion, chainId: p.chainId, verifyingContract: p.token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: { owner: p.owner, spender: p.spender, value: p.value, nonce: p.nonce, deadline: p.deadline },
  };
}

export interface TypedDataLike {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** JSON-safe copy (bigint -> decimal string) for wallets whose typed-data API takes plain JSON. */
export function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}
