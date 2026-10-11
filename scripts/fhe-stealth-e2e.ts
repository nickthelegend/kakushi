// Stealth + FHE end to end on Kakushi's local Monad hub fork: "hide who AND how much".
//   node scripts/fhe-stealth-e2e.ts
// Needs: pnpm stack:up && pnpm deploy:local (ZK: stealth registry + announcer on :18710) and
// node scripts/fhe-local.ts up (FHE: core + cUSDC + ConfidentialStealthPay, engine :8899, gateway :8890).
// It drives the same flow code as the app's /confidential and /receive pages
// (packages/app/src/lib/confidential.ts), with the native engine CLI as the encryptor instead of
// the browser's tfhe WASM. Real tfhe-rs ciphertexts, real fork USDC, real signed transactions.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseUnits, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STEALTH_KEYS_MESSAGE, buildRegisterKeysCalldata, decodeStealthMetadata, generateStealthKeys, readStealthMetaAddress, scanAnnouncements } from "@kakushi/sdk";
import { KakushiFheClient } from "@kakushi/fhe-sdk";
import { nativeEncryptor } from "@kakushi/fhe-sdk/node";
import {
  DEFAULT_STEALTH_GAS,
  balanceHandle,
  claimPayLink,
  confidentialMatch,
  createPayLink,
  parsePayLinkFragment,
  payLinkFragment,
  readPayLink,
  moveFromStealth,
  payEncrypted,
  payStealth,
  publicBalance,
  reveal,
  revealBalance,
  unwrap,
  walletSigner,
  wrap,
  type ConfidentialEnv,
  type FhePublicConfig,
} from "../packages/app/src/lib/confidential.ts";
import { LOCAL_KEYS } from "./local-accounts.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const results: { name: string; pass: boolean; detail: string }[] = [];
const say = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

async function main() {
  const t0 = Date.now();
  const fhePath = `${ROOT}config/generated/fhe.local.json`;
  if (!existsSync(fhePath)) throw new Error("config/generated/fhe.local.json missing: run node scripts/fhe-local.ts up");
  const local = JSON.parse(readFileSync(fhePath, "utf8"));
  const zk = JSON.parse(readFileSync(`${ROOT}config/generated/deployments.local.json`, "utf8"));
  const registry = zk.hub.privacy.stealthRegistry as Hex;
  const RPC = local.rpc as string;
  const chain = defineChain({ id: 10143, name: "Monad testnet (Kakushi hub fork)", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
  const client = createPublicClient({ chain, transport: http(RPC) });
  const health = await fetch(`${local.gateway}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error(`FHE gateway ${local.gateway} is down: node scripts/fhe-local.ts up`);

  const cfg: FhePublicConfig = { chainId: 10143, deployBlock: local.deployBlock, core: local.core, tokens: local.tokens, stealthPay: local.stealthPay, stealthAnnouncer: local.stealthAnnouncer, gateway: local.gateway };
  const engineBin = [`${ROOT}fhe/engine/bin/kakushi-fhe-engine`, `${process.env.HOME}/.cache/kakushi-fhe-target/release/kakushi-fhe-engine`].find((p) => existsSync(p))!;
  const fhe = new KakushiFheClient({ gatewayUrl: local.gateway, chainId: 10143, encryptor: nativeEncryptor(engineBin) });
  const env: ConfidentialEnv = { client: client as never, fhe, cfg };
  const token = cfg.tokens.find((t) => t.key === "cUSDC")!;
  const wallet = (key: Hex) => createWalletClient({ chain, account: privateKeyToAccount(key), transport: http(RPC) });
  // the app's two labelled local accounts (anvil #4 pays, anvil #6 receives)
  const alice = walletSigner(wallet(LOCAL_KEYS.user));
  const bobWallet = wallet(LOCAL_KEYS.user2);
  const bob = walletSigner(bobWallet);
  const usd = (v: bigint) => `${formatUnits(v, token.decimals)} ${token.underlyingSymbol}`;
  console.log(`hub fork ${RPC} · ${token.symbol} ${token.address} over real ${token.underlyingSymbol} ${token.underlying} · ConfidentialStealthPay ${cfg.stealthPay} · announcer ${cfg.stealthAnnouncer}`);

  // ---------------------------------------------------------------- 1. wrap
  say("1 · alice makes 25 USDC private (wrap)");
  const W = parseUnits("25", 6);
  const aliceBefore = await revealBalance(env, alice, token);
  const pubBefore = await publicBalance(env, token, alice.address);
  await wrap(env, alice, token, W, (m) => console.log(`  ${m}`));
  const aliceAfter = await revealBalance(env, alice, token);
  const pubAfter = await publicBalance(env, token, alice.address);
  results.push({ name: "Wrap (USDC -> private)", pass: aliceAfter - aliceBefore === W && pubBefore - pubAfter === W, detail: `alice's encrypted balance ${usd(aliceBefore)} -> ${usd(aliceAfter)} (revealed by her own EIP-712 user decrypt); public USDC -${usd(pubBefore - pubAfter)}` });

  // ---------------------------------------------------------------- 2. bob's private address
  say("2 · bob turns on private receiving (stealth keys from one wallet signature, ERC-6538)");
  const keys = generateStealthKeys(await bobWallet.signMessage({ account: bobWallet.account, message: STEALTH_KEYS_MESSAGE }));
  let meta = await readStealthMetaAddress(client as never, registry, bob.address);
  if (meta?.toLowerCase() !== keys.metaAddress.toLowerCase()) {
    const hash = await bobWallet.sendTransaction({ account: bobWallet.account, chain, to: registry, data: buildRegisterKeysCalldata(keys.metaAddress) });
    await client.waitForTransactionReceipt({ hash });
    meta = await readStealthMetaAddress(client as never, registry, bob.address);
  }
  console.log(`  alice resolves bob's wallet ${bob.address} -> ${meta!.slice(0, 24)}…`);

  // ---------------------------------------------------------------- 3. encrypted pay to a stealth address
  say("3 · alice pays bob 12.345678 USDC: encrypted amount, one-time stealth address, gas included");
  const P = parseUnits("12.345678", 6);
  const fromBlock = await client.getBlockNumber();
  const sent = await payStealth(env, alice, token, meta!, P, DEFAULT_STEALTH_GAS, (m) => console.log(`  ${m}`));
  const tx = await client.getTransaction({ hash: sent.receipt.transactionHash });
  const md = decodeStealthMetadata(sent.metadata!);
  const chainSees = `tx from alice to ConfidentialStealthPay, value ${formatUnits(tx.value, 18)} MON (gas for the recipient), amount = ciphertext ${md.encryptedAmount!.slice(0, 18)}…`;
  console.log(`  the chain sees: ${chainSees}`);
  console.log(`  metadata ${sent.metadata}`);
  results.push({ name: "Encrypted pay to a stealth address", pass: md.kind === "confidential" && md.token?.toLowerCase() === token.address.toLowerCase() && !sent.metadata!.includes(P.toString(16).padStart(64, "0")), detail: `one tx (${sent.receipt.gasUsed} gas): ${chainSees.replace(/^tx /, "")}; metadata selector ${md.selector}, token ${token.symbol}` });

  // ---------------------------------------------------------------- 4. scanner
  say("4 · bob's inbox scans the announcer with his viewing key");
  const latest = await client.getBlockNumber();
  const matches = await scanAnnouncements(client as never, cfg.stealthAnnouncer, fromBlock, latest, { viewingKey: keys.viewingKey, spendingPublicKey: keys.spendingPublicKey, spendingKey: keys.spendingKey }, { withBalances: true });
  const found = matches.map((m) => confidentialMatch(m, cfg)).find((m) => m && m.stealthAddress.toLowerCase() === sent.stealthAddress.toLowerCase());
  const stealthKeyOk = Boolean(found?.stealthPrivateKey && privateKeyToAccount(found.stealthPrivateKey).address.toLowerCase() === sent.stealthAddress.toLowerCase());
  results.push({ name: "Scanner finds it", pass: Boolean(found) && stealthKeyOk && found!.balance === DEFAULT_STEALTH_GAS, detail: found ? `${matches.length} match(es); FHE payment at ${found.stealthAddress} in ${found.ctoken.symbol}; stealth key derived (computeStealthPrivateKey) controls it; gas there ${formatUnits(found.balance ?? 0n, 18)} MON` : "not found" });
  if (!found?.stealthPrivateKey) throw new Error("scanner did not find the payment");

  // ---------------------------------------------------------------- 5. reveal with the stealth key
  say("5 · bob reveals the amount with the STEALTH private key (EIP-712 user decrypt, sealed)");
  const stealthWallet = wallet(found.stealthPrivateKey);
  const stealth = walletSigner(stealthWallet);
  const amt = (await reveal(env, stealth, token, [found.encryptedAmount]))[found.encryptedAmount.toLowerCase()];
  let outsiderRefused = false;
  await reveal(env, walletSigner(wallet(generatePrivateKey())), token, [found.encryptedAmount]).catch(() => (outsiderRefused = true));
  results.push({ name: "Stealth-key user decrypt", pass: amt === P && outsiderRefused, detail: `revealed ${amt === undefined ? "nothing" : usd(amt)} (sent ${usd(P)}); a random key is refused by the gateway's ACL check` });

  // ---------------------------------------------------------------- 6. move to bob's main wallet
  say("6 · bob moves it to his private balance (amount stays encrypted end to end)");
  const bobBefore = await revealBalance(env, bob, token);
  const gasBefore = await client.getBalance({ address: stealth.address });
  const mv = await moveFromStealth(env, stealth, token, bob.address);
  const gasAfter = await client.getBalance({ address: stealth.address });
  const bobAfter = await revealBalance(env, bob, token);
  const left = (await reveal(env, stealth, token, [await balanceHandle(env, token, stealth.address)]));
  const leftAmt = Object.values(left)[0];
  results.push({ name: "Move to main wallet", pass: bobAfter - bobBefore === P && leftAmt === 0n && gasBefore > gasAfter, detail: `stealth -> ${bob.address} with confidentialTransfer(to, balanceHandle) (${mv.gasUsed} gas, paid from the forwarded ${formatUnits(DEFAULT_STEALTH_GAS, 18)} MON: ${formatUnits(gasBefore - gasAfter, 18)} used); stealth balance now ${usd(leftAmt ?? -1n)}` });
  results.push({ name: "Main wallet reveals new balance", pass: bobAfter - bobBefore === P, detail: `bob's encrypted balance ${usd(bobBefore)} -> ${usd(bobAfter)} (+${usd(bobAfter - bobBefore)})` });

  // ---------------------------------------------------------------- 7. plain encrypted pay + cash out
  say("7 · encrypted pay to a known address, then cash out");
  const before2 = await revealBalance(env, bob, token);
  await payEncrypted(env, alice, token, bob.address, parseUnits("1.5", 6), stringToHex("e2e", { size: 32 }), (m) => console.log(`  ${m}`));
  const after2 = await revealBalance(env, bob, token);
  const pubBob = await publicBalance(env, token, bob.address);
  const out = await unwrap(env, bob, token, parseUnits("2", 6), (m) => console.log(`  ${m}`));
  const pubBob2 = await publicBalance(env, token, bob.address);
  results.push({ name: "Encrypted pay + cash out", pass: after2 - before2 === parseUnits("1.5", 6) && out.released === parseUnits("2", 6) && pubBob2 - pubBob === parseUnits("2", 6), detail: `bob +${usd(after2 - before2)} encrypted; cashed out ${usd(out.released)} to public USDC (only that amount revealed, KMS callback request #${out.requestId})` });

  // ---------------------------------------------------------------- 8. pay link
  say("8 · pay link: alice escrows 3 USDC behind a one-time key; bob opens the link and claims it");
  const L = parseUnits("3", 6);
  const made = await createPayLink(env, alice, token, L, 7, (m) => console.log(`  ${m}`));
  const opened = parsePayLinkFragment(`#${payLinkFragment(token.address, made.id, made.key)}`)!;
  const before3 = await revealBalance(env, bob, token);
  await claimPayLink(env, bob, token, opened.id, opened.key);
  const after3 = await revealBalance(env, bob, token);
  const state = (await readPayLink(env, token, made.id)).state;
  results.push({ name: "Pay link", pass: after3 - before3 === L && state === "Claimed", detail: `link #${made.id} (key only in the URL fragment) claimed by bob: +${usd(after3 - before3)} encrypted, link ${state}` });

  say(`Kakushi stealth + FHE e2e on the hub fork (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

main()
  .catch((e) => {
    console.error(e);
    results.push({ name: "setup", pass: false, detail: (e as Error).message.split("\n")[0]! });
  })
  .finally(() => {
    for (const r of results) console.log(`${r.pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${r.name.padEnd(34)} ${r.detail}`);
    process.exit(results.length > 0 && results.every((r) => r.pass) ? 0 : 1);
  });
