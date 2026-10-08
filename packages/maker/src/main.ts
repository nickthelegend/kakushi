// Kakushi Maker node.
//   MAKER_NAME="Maker A" MAKER_KEY=0x... MAKER_PORT=3711 node src/main.ts
// or a Privy server wallet: PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_MAKER_WALLET_ID /
// PRIVY_MAKER_WALLET_ADDRESS (+ PRIVY_AUTHORIZATION_KEY).
import { kakushiFromDisk } from "@kakushi/sdk/node";
import { MakerDb } from "./db.ts";
import { MakerEngine } from "./engine.ts";
import { makerServer } from "./server.ts";
import { makerSigner } from "./signer.ts";

const name = process.env.MAKER_NAME ?? "Maker";
const port = Number(process.env.MAKER_PORT ?? "3711");
const k = kakushiFromDisk();
const { account, kind } = makerSigner();
const dbPath = process.env.MAKER_DB ?? `.data/maker-${account.address.toLowerCase()}-${k.network}.sqlite`;
const engine = new MakerEngine(k, account, { name, db: new MakerDb(dbPath) });
engine.paused = process.env.MAKER_PAUSED === "1";
engine.start();
makerServer(engine, { adminToken: process.env.MAKER_ADMIN_TOKEN, signerKind: kind }).listen(port, "127.0.0.1", () => {
  console.log(`[${name}] ${account.address} (${kind} signer) on :${port}, network ${k.network}, db ${dbPath}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { engine.stop(); process.exit(0); });
