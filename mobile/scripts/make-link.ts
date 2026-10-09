// DEV helper (local fork only): DEV alice creates a pay link with the app's own code and prints it,
// e.g. to open it in the Expo web build or the simulator.
//   node scripts/make-link.ts 5.25 [base-url]
// base-url defaults to http://localhost:8081 (Expo web); the fhishpay:// form is printed too.
import { NETWORKS } from "../src/lib/config.ts";
import { devWallet } from "../src/lib/wallet.ts";
import { linkUrls } from "../src/lib/links.ts";
import * as P from "../src/lib/pay.ts";
import { nodeEncryptor } from "./node-encryptor.ts";

const amount = P.parseAusd(process.argv[2] ?? "5");
const base = process.argv[3] ?? "http://localhost:8081";
const ctx = P.makeContext(NETWORKS.local, await nodeEncryptor());
const alice = devWallet("alice");
const r = await P.createLink(ctx, alice.account, amount);
const u = linkUrls("local", r.link.id, r.link.key);
console.log(`link #${r.link.id} (${P.formatAusd(amount)} AUSD, encrypted) tx ${r.tx.hash}`);
console.log(u.app);
console.log(u.web.replace(/^https:\/\/[^/]+/, base));
alice.end();
