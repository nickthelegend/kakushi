// LOCAL ANVIL ONLY. These are Foundry/anvil's public, well-known development keys
// (mnemonic "test test ... junk"). They are funded only on the local forks and must never
// hold value on a public network. Testnet keys come from env vars (docs/DEPLOY-LATER.md).
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export const LOCAL_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  makerA: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  makerB: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  watchtower: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  /** anvil #8: the local gasless relayer (packages/relayer) */
  relayer: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  user: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  attester: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  user2: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const satisfies Record<string, Hex>;

export type LocalRole = keyof typeof LOCAL_KEYS;
export const localAccount = (r: LocalRole) => privateKeyToAccount(LOCAL_KEYS[r]);
