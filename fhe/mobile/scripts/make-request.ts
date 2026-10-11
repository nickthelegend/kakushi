// DEV helper (local fork only): DEV bob requests an encrypted amount from DEV alice with the app's own
// code and prints the request link, e.g. to open it as alice in the Expo web build or the simulator.
//   node scripts/make-request.ts 42.50 ["rent october"] [base-url]
// base-url defaults to http://localhost:8081 (Expo web); the kakushipay:// form is printed too.
import { NETWORKS } from "../src/lib/config.ts";
import { devWallet } from "../src/lib/wallet.ts";
import { requestUrls } from "../src/lib/links.ts";
import * as P from "../src/lib/pay.ts";
import { nodeEncryptor } from "./node-encryptor.ts";

const amount = P.parseAusd(process.argv[2] ?? "5");
const memo = process.argv[3] ?? "";
const base = process.argv[4] ?? "http://localhost:8081";
const ctx = P.makeContext(NETWORKS.local, await nodeEncryptor());
const bob = devWallet("bob");
const alice = devWallet("alice");
const r = await P.requestPayment(ctx, bob.account, alice.address, amount, memo);
const u = requestUrls("local", r.id, r.tx.blockNumber, memo);
console.log(`request #${r.id}: bob asks alice for ${P.formatAusd(amount)} AUSD (encrypted) tx ${r.tx.hash}`);
console.log(u.app);
console.log(u.web.replace(/^https:\/\/[^/]+/, base));
bob.end();
alice.end();
