// Adapter: MetaMask Agent Wallet executor -> Kakushi Port. Transactions and EIP-712 signatures go
// through the wallet's own executor, so Guard Mode, Blockaid and 2FA still apply to every step.
import type { CommandIO, PluginCommandContext } from "@metamask/agent-wallet/plugin";
import { createPublicClient, type Hex, http, type PublicClient } from "viem";
import { Kakushi, type Port } from "./core.ts";
import { loadEnv } from "./config.ts";

export async function connect(ctx: PluginCommandContext, io: CommandIO, commandId: string, submit: boolean): Promise<Kakushi> {
  const env = loadEnv();
  const state = ctx.walletStateManager.read();
  const address = [...state.byokWallets, ...state.remoteWallets][0]?.address as Hex | undefined;
  if (!address) throw new Error("no wallet: run `mm wallet create` or import a key first");
  const client = (env.rpcUrl ? createPublicClient({ transport: http(env.rpcUrl) }) : ctx.publicClient(env.chainId)) as PublicClient;
  const exec = submit ? await ctx.walletExecutor(io, commandId) : null;
  const need = () => {
    if (!exec) throw new Error(`${commandId} is read-only`);
    return exec;
  };
  const port: Port = {
    address,
    chainId: env.chainId,
    client,
    async send(tx) {
      const r = await need()({ kind: "transaction", chainId: env.chainId, transaction: tx }, { waitForReceipt: true });
      if (r.kind !== "transaction" || !r.hash) throw new Error(`wallet did not submit: ${r.failureDescription ?? r.status}`);
      return r.hash as Hex;
    },
    async signTypedData(typedData) {
      const r = await need()({ kind: "typed-data", chainId: env.chainId, typedData });
      if (r.kind !== "signature" || !r.signature) throw new Error(`wallet did not sign: ${r.failureDescription ?? r.status}`);
      return r.signature as Hex;
    },
  };
  return new Kakushi(port, env);
}
