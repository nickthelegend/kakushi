// Parity check: for each local account, the activity feed built from the Envio indexer (+ chain tip)
// must equal the feed built from raw chain logs. Bundled with esbuild because flows.ts uses the app's
// "@/" alias. From app/:
//   esbuild scripts/activity-parity.ts --bundle --platform=node --format=esm --alias:@=./src \
//     --external:viem --external:'@fhish/*' --outfile=.parity.mjs && node .parity.mjs
import { createPublicClient, defineChain, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { activityFromChain, activityWithSource, type PayEnv } from "../src/lib/pay/flows";

const APP = process.env.APP_URL ?? "http://localhost:3810";
const ROOT = `${process.cwd()}/../`; // run from app/
const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local.json`, "utf8"));
const apps = JSON.parse(readFileSync(`${ROOT}contracts/deployments/local-apps.json`, "utf8"));
// the browser calls /api/indexer relative to the page; point it at the running app
const f = globalThis.fetch;
globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => f(typeof u === "string" && u.startsWith("/") ? `${APP}${u}` : u, i)) as typeof fetch;

const chain = defineChain({ id: 10143, name: "fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:18810"] } } });
const client = createPublicClient({ chain, transport: http() }) as PublicClient;
const env = { client, fhish: null as never, token: apps.causd, ausd: apps.ausd, oracle: dep.oracle, chainId: 10143, network: "local", fromBlock: BigInt(dep.deployBlock) } as PayEnv;
const KEYS = ["0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"] as Hex[];

let ok = true;
for (const k of KEYS) {
  const who = privateKeyToAccount(k).address;
  const [idx, raw] = await Promise.all([activityWithSource(env, who), activityFromChain(env, who)]);
  const key = (a: { kind: string; tx: string; handle: string; publicAmount?: bigint }) => `${a.kind}|${a.tx.toLowerCase()}|${a.kind === "wrapped" ? a.publicAmount : a.handle.toLowerCase()}`;
  const A = new Set(idx.items.map(key));
  const B = new Set(raw.map(key));
  const onlyIdx = [...A].filter((x) => !B.has(x));
  const onlyRaw = [...B].filter((x) => !A.has(x));
  const same = idx.source === "indexer" && onlyIdx.length === 0 && onlyRaw.length === 0;
  ok &&= same;
  console.log(`${same ? "ok  " : "FAIL"} ${who} · source ${idx.source} (indexed to ${idx.indexedTo}) · ${idx.items.length} items vs ${raw.length} from logs${onlyIdx.length ? ` · only in indexer: ${onlyIdx.slice(0, 3).join(", ")}` : ""}${onlyRaw.length ? ` · only in logs: ${onlyRaw.slice(0, 3).join(", ")}` : ""}`);
}
console.log(ok ? "PARITY OK" : "PARITY MISMATCH");
process.exit(ok ? 0 : 1);
