// Kakushi relayer.
//   RELAYER_KEY=0x... RELAYER_POOLS='[{"chainId":10143,"pool":"0x...","minFee":"1000000000000000"}]' node src/main.ts
// See src/config.ts for every variable. The key is never logged; only its address is.
import { loadRelayerConfig } from "./config.ts";
import { Relayer } from "./relayer.ts";
import { relayerServer } from "./server.ts";

const cfg = loadRelayerConfig();
const relayer = new Relayer({ account: cfg.account, pools: cfg.pools });
relayerServer(relayer).listen(cfg.port, cfg.host, () => {
  console.log(`[relayer] ${relayer.address} on ${cfg.host}:${cfg.port}, ${cfg.pools.length} pool(s) on chains ${relayer.info().chains.join(", ")}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
