import { createPublicClient, http } from "viem";
const c = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const latest = await c.getBlockNumber();
let found = [];
for (let to = latest; to > latest - 30000n && found.length < 3; to -= 100n) {
  const logs = await c.getLogs({ address: "0xc50A536E04DA4E2385e66fCf211820438F4905Da", fromBlock: to - 99n, toBlock: to }).catch(() => []);
  for (const l of logs) found.push(l);
}
for (const l of found) { const tx = await c.getTransaction({ hash: l.transactionHash }); const b = await c.getBlock({ blockNumber: l.blockNumber }); console.log(l.blockNumber, l.transactionHash, "from", tx.from, "to", tx.to, new Date(Number(b.timestamp) * 1000).toISOString()); }
