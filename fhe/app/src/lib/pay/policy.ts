// The Privy policy that fences the payroll operator (a Privy server wallet). Shared by
// scripts/privy-setup.ts (which creates it through the Privy API) and the employer console (which
// shows it). Privy's policy engine evaluates it inside its enclave before any signature exists:
// default DENY, and every condition in a rule must hold for that rule to ALLOW.
import { getAddress, type Hex } from "viem";
import type { PolicyCondition, PolicyCreateParams, PolicyMethod } from "@privy-io/node/resources";
import { MONAD_TESTNET_ID } from "./core.ts"; // .ts: also loaded by Node (scripts/privy-setup.ts)

/** JSON ABI fragment Privy uses to decode calldata for the `ethereum_calldata` conditions. */
export const RUN_PAYROLL_FROM_ABI = [
  {
    type: "function",
    name: "runPayrollFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "employer", type: "address", internalType: "address" },
      { name: "to", type: "address[]", internalType: "address[]" },
      { name: "amounts", type: "bytes32[]", internalType: "bytes32[]" },
      { name: "proofs", type: "bytes[]", internalType: "bytes[]" },
      { name: "ref", type: "bytes32", internalType: "bytes32" },
      { name: "deadline", type: "uint256", internalType: "uint256" },
      { name: "employerSignature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
  },
] as const;

export interface PayrollPolicyOptions {
  token: Hex; // cAUSD
  notAfter: number; // unix seconds
  /** also allow eth_sendTransaction (Privy broadcasts; needed for sponsor: true) */
  allowSend?: boolean;
  /** restrict to these employers (runPayrollFrom.employer), optional */
  employers?: Hex[];
}

export function payrollPolicy(o: PayrollPolicyOptions): PolicyCreateParams {
  const conditions: PolicyCondition[] = [
    // Privy compares strings case-sensitively: accept the lowercase and the checksummed spelling
    { field_source: "ethereum_transaction", field: "to", operator: "in", value: [o.token.toLowerCase(), getAddress(o.token)] },
    { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(MONAD_TESTNET_ID) },
    { field_source: "ethereum_calldata", field: "function_name", abi: RUN_PAYROLL_FROM_ABI, operator: "eq", value: "runPayrollFrom" },
    { field_source: "system", field: "current_unix_timestamp", operator: "lt", value: String(o.notAfter) },
  ];
  if (o.employers?.length)
    conditions.push({ field_source: "ethereum_calldata", field: "runPayrollFrom.employer", abi: RUN_PAYROLL_FROM_ABI, operator: "in", value: o.employers.flatMap((e) => [e.toLowerCase(), getAddress(e)]) });
  const methods: PolicyMethod[] = o.allowSend === false ? ["eth_signTransaction"] : ["eth_signTransaction", "eth_sendTransaction"];
  return {
    version: "1.0",
    name: "Kakushi payroll operator",
    chain_type: "ethereum",
    rules: methods.map((method) => ({
      name: `${method}: only cAUSD.runPayrollFrom on Monad testnet, until ${new Date(o.notAfter * 1000).toISOString().slice(0, 10)}`,
      method,
      action: "ALLOW",
      conditions,
    })),
  };
}

/** Human summary for the UI. */
export function describePolicy(token: Hex, notAfter?: number) {
  return [
    `Only calls to cAUSD ${token.slice(0, 8)}…`,
    "Only the function runPayrollFrom",
    `Only on Monad testnet (chain ${MONAD_TESTNET_ID})`,
    notAfter ? `Only until ${new Date(notAfter * 1000).toLocaleDateString()}` : "Only until a fixed date",
    "Everything else, including transfers out, is denied by default",
  ];
}
