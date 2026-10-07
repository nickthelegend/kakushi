import { z } from "zod";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const address = hex.length(42);

/** Config of one kakushi-attest-<chain> workflow instance. */
export const attestConfigSchema = z.object({
  /** six-field cron, seconds first; CRE's fastest is every 30 s */
  schedule: z.string().min(1),
  hub: z.object({
    chainSelectorName: z.string(),
    oracle: address,
    ebc: address,
  }),
  chain: z.object({
    chainSelectorName: z.string(),
    chainId: z.number().int().positive(),
    payoutRouter: address,
    sourceRouter: address,
    tokens: z.array(address),
    /** first block to attest (router deployment block) */
    startBlock: z.string().regex(/^\d+$/),
    /** "finalized" uses the finalized tag; otherwise latest - confirmations (DEMO ASSUMPTION) */
    head: z.enum(["finalized", "latest"]),
    confirmations: z.number().int().min(0),
    /** CRE log queries are limited to 100 blocks */
    maxBlocks: z.number().int().min(1).max(100),
  }),
  gasLimit: z.string().regex(/^\d+$/),
});
export type AttestConfig = z.infer<typeof attestConfigSchema>;

/** Config of kakushi-source-native (HTTP trigger). */
export const nativeConfigSchema = z.object({
  hub: z.object({ chainSelectorName: z.string(), oracle: address, ebc: address }),
  /** chainId -> JSON-RPC URL read through the HTTP capability (consensus over identical answers) */
  rpcs: z.record(z.string(), z.string().url()),
  confirmations: z.record(z.string(), z.number().int().min(0)),
  authorizedKeys: z.array(hex).default([]),
  gasLimit: z.string().regex(/^\d+$/),
});
export type NativeConfig = z.infer<typeof nativeConfigSchema>;
