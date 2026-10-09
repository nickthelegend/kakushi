// Monad-aware transaction sending:
//  - gas: Monad bills the gas LIMIT, so every tx carries an explicit limit of estimate + 30%
//  - eth_sendRawTransactionSync (EIP-7966): one round trip from raw tx to receipt where the RPC
//    supports it (Monad does), falling back to send + poll elsewhere (e.g. older anvil)
import type { Hex, PublicClient, WalletClient } from "viem";

let syncSupported: boolean | undefined;
// one queue per sender: concurrent deliveries must not race for the same nonce
const queues = new Map<string, Promise<unknown>>();

export function sendSync(client: PublicClient, wallet: WalletClient, tx: { to: Hex; data: Hex }): Promise<{ hash: Hex; status: "success" | "reverted"; sync: boolean }> {
  const key = wallet.account!.address.toLowerCase();
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => send(client, wallet, tx));
  queues.set(key, run);
  return run;
}

async function send(client: PublicClient, wallet: WalletClient, tx: { to: Hex; data: Hex }): Promise<{ hash: Hex; status: "success" | "reverted"; sync: boolean }> {
  const account = wallet.account!;
  const est = await client.estimateGas({ account, to: tx.to, data: tx.data });
  const request = await wallet.prepareTransactionRequest({ account, chain: wallet.chain, to: tx.to, data: tx.data, gas: (est * 13n) / 10n });
  const raw = await wallet.signTransaction({ ...request, account, chain: wallet.chain } as never);
  if (syncSupported !== false) {
    try {
      const rc = (await client.request({ method: "eth_sendRawTransactionSync" as never, params: [raw] as never })) as { transactionHash: Hex; status: Hex };
      syncSupported = true;
      return { hash: rc.transactionHash, status: rc.status === "0x1" ? "success" : "reverted", sync: true };
    } catch (e) {
      const m = (e as Error).message;
      if (!/not (found|supported|available)|does not exist|Method not found|-32601|unsupported/i.test(m)) throw e;
      syncSupported = false;
    }
  }
  const hash = await client.sendRawTransaction({ serializedTransaction: raw });
  const rc = await client.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  return { hash, status: rc.status, sync: false };
}
