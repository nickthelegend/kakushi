import type { Hex } from "viem";
import type { Leaf } from "@kakushi/attest-core";
import type { IChainAdapter, IncomingPayment, PayoutResult, TxRequest } from "./types.ts";

/**
 * DEMO ASSUMPTION: Solana is NOT wired into Kakushi. This adapter shows that a non-EVM chain
 * fits the same interface. Encoding idea: SPL/SOL amounts carry the ident code in the last 4
 * digits exactly as on EVM; a Memo instruction may carry a custom recipient. A Solana
 * PayoutRouter program and a CRE Solana read path would be needed to make it live
 * (README "Add a chain"). The methods that would touch the network throw.
 */
export class SolanaAdapterStub implements IChainAdapter {
  readonly vmKind = "solana" as const;
  readonly finalityBlocks = 32; // slots to "finalized" commitment
  readonly chainId: number;
  constructor(chainId: number) {
    this.chainId = chainId;
  }

  encodePayment(to: string, token: string, amount: bigint, identCode: number): TxRequest {
    if (amount % 10_000n !== BigInt(identCode)) throw new Error("amount must end in the ident code");
    // a SystemProgram/SPL transfer of `amount` to the Maker; `data` describes the memo (custom recipient)
    return { to, value: amount, data: `memo:kakushi:${token}` };
  }

  // eslint-disable-next-line require-yield
  async *watchIncoming(_maker: Hex): AsyncIterable<IncomingPayment> {
    throw new Error("Solana adapter is a stub (DEMO ASSUMPTION): not wired");
  }

  async submitPayout(): Promise<PayoutResult> {
    throw new Error("Solana adapter is a stub (DEMO ASSUMPTION): not wired");
  }

  async getProofInputs(): Promise<Leaf | null> {
    throw new Error("Solana adapter is a stub (DEMO ASSUMPTION): not wired");
  }
}
