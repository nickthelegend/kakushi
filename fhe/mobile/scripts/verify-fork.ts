// Drives the app's own non-UI modules (src/lib/*, src/fhe/*) against the local Monad-testnet fork:
//   node scripts/verify-fork.ts
// - the tfhe encryptor is the exact <script> the app loads into its hidden WebView, run in a vm context
// - Mera passkey accounts use the real @category-labs/mera code with a software WebAuthn
//   authenticator that implements PRF (HMAC-SHA256 per credential), so create -> restore-without-
//   storage -> same address is exercised end to end (only the OS passkey sheet is simulated)
// - every write is signed locally, gas = estimate x 1.3, sent with eth_sendRawTransactionSync
// Prints one PASS/FAIL line per check and exits non-zero on any failure. Local fork only.
import { nodeEncryptor } from "./node-encryptor.ts";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { WebAuthnClient } from "@category-labs/mera";
import { NETWORKS } from "../src/lib/config.ts";
import { devWallet, createPasskeyWallet, passkeyWallet } from "../src/lib/wallet.ts";
import { linkUrls, parseLink, parseRequestLink, requestUrls } from "../src/lib/links.ts";
import { MonadHeads } from "../src/lib/monad.ts";
import * as P from "../src/lib/pay.ts";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ·  ${detail}`);
};
const ladder = (t: { at: Record<string, number | undefined> }) => Object.entries(t.at).map(([k, v]) => `${k} ${v} ms`).join(" → ");

// ---------------------------------------------------------------- encryptor (the WebView page)
const encryptor = await nodeEncryptor();
check("tfhe encryptor page boots", encryptor.ready, `node-tfhe 1.8.1 wasm ready in ${encryptor.readyMs} ms (same <script> as the WebView)`);

// ---------------------------------------------------------------- Mera passkey account (software authenticator)
const creds = new Map<string, Uint8Array>();
const softAuthenticator: WebAuthnClient = {
  async createCredential(req) {
    const id = crypto.getRandomValues(new Uint8Array(16));
    const secret = crypto.getRandomValues(new Uint8Array(32));
    creds.set(Buffer.from(id).toString("hex"), secret);
    return { credentialId: id, prfEnabled: true, prfOutput: hmac(sha256, secret, req.prfSalt) };
  },
  async getCredential(req) {
    const id = req.allowCredential ? Buffer.from(req.allowCredential.credentialId).toString("hex") : [...creds.keys()].at(-1)!;
    const secret = creds.get(id);
    if (!secret) throw new Error("no credential");
    return { credentialId: Buffer.from(id, "hex"), prfOutput: hmac(sha256, secret, req.prfSalt) };
  },
};
const env = { rpId: "pay.kakushi.example", rpName: "Kakushi Pay", webAuthnClient: softAuthenticator };
const created = await createPasskeyWallet(env, "verify");
const createdAddr = created.address;
created.end();
let ended = false;
await created.account.signMessage({ message: "x" }).catch((e: any) => (ended = e?.code === "SESSION_ENDED" || /ended/i.test(String(e?.message))));
const restored = await passkeyWallet(env); // fresh install: no stored state, discoverable credential
const pinned = await passkeyWallet(env, restored.credentialId); // session renewal pinned to the credential
check("Mera: create passkey -> address", /^0x[0-9a-fA-F]{40}$/.test(createdAddr), createdAddr);
check("Mera: restore with nothing stored -> same address", restored.address === createdAddr && pinned.address === createdAddr, `${restored.address} (discoverable) / ${pinned.address} (pinned)`);
check("Mera: session.end() zeroes the key", ended, "signing after end() throws SESSION_ENDED");
pinned.end();
const newcomer = restored; // the link claimant: a brand-new passkey account that never held gas

// ---------------------------------------------------------------- Kakushi Pay on the fork
const net = NETWORKS.local;
const alice = devWallet("alice");
const bob = devWallet("bob");
const sponsor = devWallet("carol");
const ctx = P.makeContext(net, encryptor, sponsor.account);
console.log(`\nfork ${net.rpcUrl} · gateway ${net.gatewayUrl} · cAUSD ${ctx.causd}`);

const pk = await ctx.fhe.publicKey();
const enc = await ctx.fhe.encrypt("euint64", 1n, ctx.causd, alice.address);
check("encrypt on device + gateway attestation", /^0x[0-9a-f]{64}$/i.test(enc.handle), `pk ${pk.length} B · tfhe ${encryptor.lastEncryptMs} ms · attest ${enc.ms.attest} ms · handle ${P.shortHex(enc.handle)}`);

const bal0 = await P.balances(ctx, alice.address);
const revealA0 = await P.reveal(ctx, alice.account, bal0.handle);
console.log(`alice: ${P.formatAusd(bal0.ausd)} AUSD public · ${P.formatAusd(revealA0)} cAUSD revealed`);

// faucet (Agora's real contract on the fork; 60 s global cooldown)
try {
  const before = bal0.ausd;
  const f = await P.faucet(ctx, alice.account, alice.address);
  const after = (await P.balances(ctx, alice.address)).ausd;
  check("AUSD faucet (sponsored)", after - before === 10_000_000_000n, `+${P.formatAusd(after - before)} AUSD · tx ${P.shortHex(f.hash)} · sync=${f.sync}`);
} catch (e) {
  check("AUSD faucet (sponsored)", /cooling down/.test(P.describeError(e)), `cooldown handled: ${P.describeError(e)}`);
}

// make private: ERC-3009 signature, sponsor submits
const wrapAmt = P.parseAusd("100");
const w = await P.wrapWithSignature(ctx, alice.account, wrapAmt);
const wl = await P.settle(ctx, w, null, () => {});
const revealA1 = await P.reveal(ctx, alice.account, (await P.balances(ctx, alice.address)).handle);
check("make private: ERC-3009 wrap submitted by sponsor", w.sponsored && revealA1 - revealA0 === wrapAmt, `cAUSD +${P.formatAusd(revealA1 - revealA0)} · gas limit ${w.gasLimit} (est x1.3) · sync=${w.sync} · ${ladder(wl)}`);

// pay alice -> bob (encrypted amount)
const bobH0 = (await P.balances(ctx, bob.address)).handle;
const bobB0 = await P.reveal(ctx, bob.account, bobH0);
const payAmt = P.parseAusd("12.5");
const sent = await P.pay(ctx, alice.account, bob.address, payAmt, "rent october");
const pl = await P.settle(ctx, sent.tx, null, () => {});
const bobH1 = (await P.balances(ctx, bob.address)).handle;
const bobB1 = await P.reveal(ctx, bob.account, bobH1);
const calldata = (await ctx.pub.getTransaction({ hash: sent.tx.hash })).input;
const leaks = calldata.toLowerCase().includes(payAmt.toString(16).padStart(16, "0"));
check("pay: encrypted send alice -> bob", bobB1 - bobB0 === payAmt && !leaks, `bob +${P.formatAusd(bobB1 - bobB0)} (revealed by bob only) · amount absent from calldata · ${ladder(pl)}`);

let peek = "allowed";
await P.reveal(ctx, alice.account, bobH1).then(
  () => {},
  (e) => (peek = P.describeError(e)),
);
check("privacy: alice cannot reveal bob's balance", peek !== "allowed", peek);

// pay link -> brand-new passkey account, claimed with no gas of its own
const linkAmt = P.parseAusd("7.25");
const L = await P.createLink(ctx, alice.account, linkAmt);
const urls = linkUrls("local", L.link.id, L.link.key);
const parsedApp = parseLink(urls.app);
const parsedWeb = parseLink(urls.web);
check("pay link: create + URL round trip", parsedApp?.id === L.link.id && parsedApp?.key === L.link.key && parsedWeb?.key === L.link.key, `link #${L.link.id} · ${urls.app.replace(/#k=.*/, "#k=<one-time key>")}`);
const monBefore = await ctx.pub.getBalance({ address: newcomer.address });
const C = await P.claimLink(ctx, newcomer.account, parsedApp!.id, parsedApp!.key, newcomer.address);
const cl = await P.settle(ctx, C.tx, null, () => {});
const nb = await P.reveal(ctx, newcomer.account, (await P.balances(ctx, newcomer.address)).handle);
const got = C.received ? await P.reveal(ctx, newcomer.account, C.received) : -1n; // what the Claim screen reveals
check("pay link: claimed by the Mera account (sponsored, 0 MON)", C.sponsored && monBefore === 0n && nb === linkAmt && got === linkAmt, `newcomer ${P.shortHex(newcomer.address)} revealed ${P.formatAusd(nb)} cAUSD via Mera signTypedData (link amount from the claim receipt: ${P.formatAusd(got)}) · ${ladder(cl)}`);
let again = "";
await P.claimLink(ctx, newcomer.account, parsedApp!.id, parsedApp!.key, newcomer.address).catch((e) => (again = P.describeError(e)));
check("pay link: second claim refused", /already claimed/.test(again), again);

// cash out: bob unwraps 2 AUSD; the oracle callback pays it
const ausdB0 = (await P.balances(ctx, bob.address)).ausd;
const stages: string[] = [];
const U = await P.unwrap(ctx, bob.account, P.parseAusd("2"), (s) => stages.push(s));
const ausdB1 = (await P.balances(ctx, bob.address)).ausd;
check("cash out: unwrap + oracle callback", ausdB1 - ausdB0 === 2_000_000n && U.paid === 2_000_000n, `request #${U.requestId} · callback after ${U.callbackMs} ms · bob AUSD +${P.formatAusd(ausdB1 - ausdB0)} · stages ${stages.join(">")}`);

// payment requests ("Request money"): alice (payee) asks bob (payer) for an encrypted amount
const reveal1 = async (who: typeof alice) => P.reveal(ctx, who.account, (await P.balances(ctx, who.address)).handle);
const reqAmt = P.parseAusd("9.75");
const RQ = await P.requestPayment(ctx, alice.account, bob.address, reqAmt, "rent october", 86400);
const rql = await P.settle(ctx, RQ.tx, null, () => {});
const rUrls = requestUrls("local", RQ.id, RQ.tx.blockNumber, "rent october");
const rApp = parseRequestLink(rUrls.app);
const rWeb = parseRequestLink(rUrls.web);
const rInfo = await P.requestInfo(ctx, RQ.id);
const rRef = await P.requestRef(ctx, rApp!.id, rApp!.block!);
const reqCalldata = (await ctx.pub.getTransaction({ hash: RQ.tx.hash })).input.toLowerCase();
check(
  "request: alice asks bob (encrypted) + link round trip",
  rApp?.id === RQ.id && rWeb?.id === RQ.id && rWeb?.memo === "rent october" && rInfo.status === "Open" && rInfo.payee === alice.address && rInfo.payer === bob.address && !!rRef && P.memoMatches(rApp!.memo!, rRef) && !reqCalldata.includes(reqAmt.toString(16).padStart(16, "0")),
  `request #${RQ.id} · ${rUrls.app} · memo hash matches on-chain ref · amount absent from calldata · ${ladder(rql)}`,
);
const bobSees = await P.reveal(ctx, bob.account, rInfo.due);
const aliceSees = await P.reveal(ctx, alice.account, rInfo.due);
check("request: payer reveals the requested amount", bobSees === reqAmt && aliceSees === reqAmt, `bob (payer) revealed ${P.formatAusd(bobSees)}, alice (payee) ${P.formatAusd(aliceSees)}`);

const aliceR0 = await reveal1(alice);
const bobR0 = await reveal1(bob);
const PR = await P.payRequest(ctx, bob.account, RQ.id);
const prl = await P.settle(ctx, PR.tx, null, () => {});
const owedAfter = await P.reveal(ctx, alice.account, (await P.requestInfo(ctx, RQ.id)).due);
const aliceR1 = await reveal1(alice);
const bobR1 = await reveal1(bob);
check(
  "request: bob pays -> alice reveals owed 0, balance +amount",
  owedAfter === 0n && aliceR1 - aliceR0 === reqAmt && bobR0 - bobR1 === reqAmt,
  `owed ${P.formatAusd(owedAfter)} · alice +${P.formatAusd(aliceR1 - aliceR0)} · bob -${P.formatAusd(bobR0 - bobR1)} · ${ladder(prl)}`,
);

// a request bob cannot afford: paying moves nothing and it stays owed
const tooMuch = bobR1 + P.parseAusd("1000");
const BIG = await P.requestPayment(ctx, alice.account, bob.address, tooMuch, "too much", 86400);
await P.payRequest(ctx, bob.account, BIG.id);
const bigInfo = await P.requestInfo(ctx, BIG.id);
const bigOwed = await P.reveal(ctx, bob.account, bigInfo.due);
const bobR2 = await reveal1(bob);
const aliceR2 = await reveal1(alice);
check(
  "request: unaffordable request stays owed",
  bigOwed === tooMuch && bobR2 === bobR1 && aliceR2 === aliceR1 && bigInfo.status === "Open",
  `request #${BIG.id} for ${P.formatAusd(tooMuch)} (bob holds ${P.formatAusd(bobR1)}): paid tx ok, nothing moved, still owed ${P.formatAusd(bigOwed)}, still open`,
);

// guards: cancel is payee-only; a cancelled request cannot be paid; only the payer pays; no self-requests
const CX = await P.requestPayment(ctx, alice.account, bob.address, P.parseAusd("1"), "", 86400);
let notPayee = "";
await P.cancelRequest(ctx, bob.account, CX.id).catch((e) => (notPayee = P.describeError(e)));
let notPayer = "";
await P.payRequest(ctx, alice.account, CX.id).catch((e) => (notPayer = P.describeError(e)));
await P.cancelRequest(ctx, alice.account, CX.id);
let afterCancel = "";
await P.payRequest(ctx, bob.account, CX.id).catch((e) => (afterCancel = P.describeError(e)));
const cxInfo = await P.requestInfo(ctx, CX.id);
check("request: cancelled by payee, then pay refused", cxInfo.status === "Cancelled" && /no longer open/.test(afterCancel), `#${CX.id} ${cxInfo.status.toLowerCase()} · bob pays: "${afterCancel}"`);
let selfReq = "";
await P.requestPayment(ctx, alice.account, alice.address, P.parseAusd("1"), "", 86400).catch((e) => (selfReq = P.describeError(e)));
check("request: role guards", /Only the person who sent/.test(notPayee) && /Only the person this request was sent to/.test(notPayer) && /payer other than yourself/.test(selfReq), `bob cancels: "${notPayee}" · alice pays own: "${notPayer}" · self-request: "${selfReq}"`);

// activity from events
const act = await P.activity(ctx, alice.address);
const kinds = new Set(act.map((a) => a.kind));
check("activity from on-chain events", kinds.has("wrapped") && kinds.has("sent") && kinds.has("link-created") && kinds.has("link-claimed"), `${act.length} items for alice: ${[...kinds].join(", ")}`);
const actB = await P.activity(ctx, bob.address);
check("activity (receiver side)", actB.some((a) => a.kind === "received") && actB.some((a) => a.kind === "cashed-out"), `${actB.length} items for bob`);
// the Envio indexer serves the same feed (FeedItem rows) as the on-device log scan, field by field
const norm = (a: P.ActivityItem) => [a.kind, a.tx, a.logIndex, a.handle ?? "", a.amount ?? "", a.linkId ?? "", a.requestId ?? "", a.role ?? "", a.counterparty ?? "", a.ref ?? ""].map((x) => String(x).toLowerCase()).join("|");
for (const [name, who, chainItems] of [["alice", alice.address, act], ["bob", bob.address, actB]] as const) {
  const idx = await P.activityWithSource(ctx, who);
  const fresh = await P.activity(ctx, who); // re-read: the chain may have moved while the indexer answered
  const A = new Set(idx.items.map(norm));
  const B = new Set(fresh.map(norm));
  const diff = [...A].filter((x) => !B.has(x)).length + [...B].filter((x) => !A.has(x)).length;
  check(`activity from the Envio indexer == on-chain scan (${name})`, idx.source === "indexer" && diff === 0, `source ${idx.source} (indexed to ${idx.indexedTo}) · ${idx.items.length} items vs ${fresh.length} from logs (${chainItems.length} earlier) · ${diff} differences`);
}
const reqKinds = (xs: P.ActivityItem[], id: bigint) => xs.filter((a) => a.requestId === id).map((a) => `${a.kind}${a.role ? `(${a.role})` : ""}`);
const aliceReq = [...reqKinds(act, RQ.id), ...reqKinds(act, CX.id)];
const bobReq = [...reqKinds(actB, RQ.id), ...reqKinds(actB, BIG.id)];
check(
  "activity: requests on both sides",
  ["request-sent(payee)", "request-paid(payee)", "request-cancelled(payee)"].every((k) => aliceReq.includes(k)) && ["request-received(payer)", "request-paid(payer)"].every((k) => bobReq.includes(k)),
  `alice: ${[...new Set(aliceReq)].join(", ")} · bob: ${[...new Set(bobReq)].join(", ")}`,
);

// live Monad heartbeat (read-only WebSocket to Monad testnet)
const heads = new MonadHeads("wss://testnet-rpc.monad.xyz");
const seen: string[] = [];
await new Promise<void>((resolve) => {
  const t = setTimeout(resolve, 6000);
  heads.on((h) => {
    seen.push(`${h.number}:${h.state}`);
    if (new Set(seen.map((s) => s.split(":")[1])).size >= 3) {
      clearTimeout(t);
      resolve();
    }
  });
  heads.start();
});
heads.stop();
const states = new Set(seen.map((s) => s.split(":")[1]));
check("Monad heartbeat (monadNewHeads, testnet, read-only)", states.size >= 3, `${seen.length} events, states ${[...states].join("/")}, e.g. ${seen.slice(-3).join(" ")}`);

for (const x of [alice, bob, sponsor, newcomer]) x.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
