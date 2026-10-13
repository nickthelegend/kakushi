import { createPublicClient, http, formatEther } from "viem";
const s = createPublicClient({ transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const latest = await s.getBlockNumber();
const logs = await s.getLogs({ address: "0x01c494922333c7bb0C268BDcda1Ac218981a5F48", fromBlock: latest - 400n, toBlock: latest });
for (const l of logs) { const tx = await s.getTransaction({ hash: l.transactionHash }); console.log(l.blockNumber, l.transactionHash, "from", tx.from, l.topics[0].slice(0, 10)); }
console.log("fresh balance", formatEther(await s.getBalance({ address: "0xD1e0544dA71f1cEf9BDde3497C1e87bFA8fce535" })));
