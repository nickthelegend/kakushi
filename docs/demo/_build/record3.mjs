// Take 3: the rest of the full flow, live, one continuous capture.
// Privy option shown -> browser wallet; Shield on Sepolia (deposit, gasless withdraw to a fresh address via the relayer);
// Bridge Monad -> Sepolia delivered privately; Confidential (make private, reveal, encrypted stealth pay, KMS cash-out);
// Attestations; Receive (scan, reveal, move); Plugin.
// Usage: node record3.mjs [--steps=a,b,...] [--out=take3.mp4]
import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { launch, attachWallet, loadAccount, startCapture, click, hover, moveTo, typeInto, smoothScroll, sleep, WORK } from "./rec-lib.mjs";

const APP = "https://kakushi.vercel.app";
const acct = loadAccount();
const ME = acct.address;
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "take3.mp4";
const only = process.argv.find((a) => a.startsWith("--steps="))?.slice(8).split(",") ?? null;
const want = (s) => !only || only.includes(s);
const FRESH = privateKeyToAccount(generatePrivateKey()).address; // a brand-new address (its key is discarded; only receives)
const txs = [];
const markers = [];
let cap = null;
const save = () => {
  fs.writeFileSync(path.join(WORK, OUT + ".markers.json"), JSON.stringify(markers, null, 2));
  fs.writeFileSync(path.join(WORK, OUT + ".txs.json"), JSON.stringify(txs, null, 2));
};
const mark = (label, extra = {}) => {
  const m = { t: cap ? +cap.now().toFixed(2) : null, label, ...extra };
  markers.push(m);
  console.log("MARK", JSON.stringify(m));
  save();
};

const { browser, context } = await launch();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
await attachWallet(context, acct, (t) => {
  if (!txs.includes(t)) txs.push(Object.assign(t, { videoT: cap ? +cap.now().toFixed(2) : null, step: markers.at(-1)?.label }));
  save();
  console.log("TX", t.chainId, t.hash, t.receiptMs ?? "");
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 160)));
const header = () => page.locator("header");
const gotoNav = async (name) => {
  const l = header().getByRole("link", { name, exact: true }).first();
  if (await l.isVisible().catch(() => false)) return click(page, l);
  await click(page, header().getByRole("button", { name: /More/ }).first());
  await sleep(400);
  await click(page, page.getByRole("menuitem", { name: new RegExp(name) }).first());
};
const connect = async () => {
  await sleep(1000);
  const b = header().getByRole("button", { name: /^Connect/ }).first();
  if (await b.isVisible().catch(() => false)) {
    await click(page, b);
    await sleep(500);
    await click(page, page.getByText("Browser wallet").first());
    await sleep(900);
    mark("connected");
  }
};
const unlock = async () => {
  const u = page.getByRole("button", { name: /Unlock with your wallet/ });
  if (await u.isVisible().catch(() => false)) {
    await click(page, u);
    await page.getByText(/Listed on Monad/).waitFor({ timeout: 30000 });
    mark("unlocked");
  }
};
const typeAmount = async (loc, v) => {
  await click(page, loc);
  await loc.fill("");
  await page.keyboard.type(v, { delay: 110 });
};

// off camera: warm the backends
for (const p of ["/bridge", "/confidential", "/shield"]) {
  await page.goto(APP + p, { waitUntil: "domcontentloaded" });
  await sleep(4000);
}
await page.mouse.move(900, 400);
cap = await startCapture(page, path.join(WORK, OUT));
mark("start", { fresh: FRESH });
try {
  if (want("privy")) {
    mark("privy");
    await click(page, header().getByRole("button", { name: /^Connect/ }).first());
    await sleep(900);
    await hover(page, page.getByText("Sign in with Privy").first(), 700);
    await sleep(700);
    await click(page, page.getByText("Sign in with Privy").first());
    await sleep(4500); // the Privy modal: email, Google or any wallet
    mark("privy modal");
    await page.keyboard.press("Escape");
    await sleep(800);
    if (await page.getByText(/Log in or sign up/i).isVisible().catch(() => false)) {
      await page.mouse.click(60, 600);
      await sleep(600);
    }
    await connect();
  } else await connect();

  if (want("shield")) {
    mark("shield deposit");
    await sleep(800);
    // chain -> Sepolia
    await click(page, page.getByRole("button", { name: /Chain/ }).first());
    await sleep(400);
    await click(page, page.getByRole("menuitem", { name: /Sepolia/ }).first());
    await sleep(2500);
    const p001 = page.locator("main").getByRole("button", { name: /^0\.001 ETH/ }).first();
    await click(page, p001);
    await sleep(700);
    await click(page, page.getByRole("button", { name: /^Shield 0\.001/ }));
    await sleep(1200);
    mark("shield note");
    await click(page, page.locator("main").getByRole("button", { name: /Copy/ }).first());
    await sleep(900);
    const note = await page.evaluate(() => navigator.clipboard.readText());
    fs.writeFileSync(path.join(WORK, OUT + ".note.txt"), note, { mode: 0o600 });
    await click(page, page.getByRole("button", { name: /^Deposit$/ }).last());
    mark("shield deposit clicked");
    await page.getByText(/^Shielded /).waitFor({ timeout: 120000 });
    mark("shield deposited");
    await sleep(2500);
    // withdraw to a fresh address through the relayer
    await click(page, page.getByRole("button", { name: /^Withdraw$/ }).first());
    mark("shield withdraw");
    await sleep(900);
    const ta = page.getByLabel("Your note");
    await click(page, ta);
    await ta.fill(note);
    await sleep(1200);
    await typeInto(page, page.getByLabel("Recipient"), FRESH, { delay: 10 });
    await sleep(900);
    const gas = page.getByText(/Gasless via relayer/).first();
    if (await gas.count()) await hover(page, gas, 600);
    await sleep(1500);
    await click(page, page.locator("main").getByRole("button", { name: /^Withdraw$/ }).last());
    mark("shield withdraw clicked");
    await page.getByText(/^Withdrawn$/).waitFor({ timeout: 240000 });
    mark("shield withdrawn");
    await sleep(3500);
  }

  if (want("bridge")) {
    await gotoNav("Bridge");
    await page.waitForURL(/\/bridge/);
    mark("bridge");
    await sleep(2500);
    const from = page.locator("main").getByText(/^From$/).first().locator("xpath=..");
    if (!/Monad/.test(await from.innerText().catch(() => ""))) {
      await click(page, page.getByRole("button", { name: "Swap direction" }));
      await sleep(1500);
    }
    await typeAmount(page.getByLabel(/^Amount of USDC to send/), "0.5");
    await sleep(800);
    await click(page, page.getByRole("button", { name: "Settings" }).first());
    await sleep(600);
    await click(page, page.getByText("Deliver privately").first());
    await sleep(800);
    await typeInto(page, page.getByLabel("Recipient private address or wallet"), ME, { delay: 10 });
    mark("bridge private");
    await sleep(3500);
    const det = page.locator("main details summary").first();
    if (await det.count()) { await click(page, det); await sleep(2500); }
    mark("bridge quote");
    const btn = page.locator("main").getByRole("button", { name: /Bridge|Send|Transfer/ }).last();
    await click(page, btn);
    mark("bridge clicked");
    await page.waitForURL(/\/tx\//, { timeout: 180000 });
    mark("bridge tx page");
    await page.getByText(/Paid out|Payout arrived/i).first().waitFor({ timeout: 240000 }).catch(() => console.log("payout text not seen"));
    mark("bridge paid");
    await sleep(4000);
  }

  if (want("fhe")) {
    await gotoNav("Confidential");
    await page.waitForURL(/\/confidential/);
    mark("fhe");
    await connect();
    await sleep(1500);
    await typeAmount(page.getByLabel(/^Amount of USDC/).first(), "1");
    await sleep(500);
    await click(page, page.getByRole("button", { name: /^Make USDC private$/ }));
    mark("fhe wrap clicked");
    await page.getByText(/is now private/).first().waitFor({ timeout: 240000 });
    mark("fhe wrapped");
    await sleep(2500);
    await click(page, page.getByRole("button", { name: /^Reveal$/ }).first());
    mark("fhe reveal clicked");
    await page.getByText("Visible in this tab only").waitFor({ timeout: 120000 });
    mark("fhe revealed");
    await sleep(3000);
    // encrypted amount to a one-time stealth address
    await click(page, page.getByRole("tab", { name: /^Pay$/ }));
    mark("fhe pay");
    await sleep(1000);
    await typeInto(page, page.getByLabel("Recipient meta-address or wallet"), ME, { delay: 10 });
    await sleep(900);
    await typeAmount(page.getByLabel(/^Amount of /).last(), "0.3");
    await sleep(600);
    await click(page, page.getByRole("button", { name: /^Pay privately$/ }));
    mark("fhe pay clicked");
    await page.getByText(/^Sent 0\.3/).first().waitFor({ timeout: 240000 });
    mark("fhe paid");
    await sleep(3500);
    // KMS cash-out
    await click(page, page.getByRole("tab", { name: /^Balance$/ }));
    await sleep(1000);
    await click(page, page.getByRole("button", { name: /^Cash out$/ }).first());
    await sleep(600);
    await typeAmount(page.getByLabel(/^Amount of /).first(), "0.2");
    await sleep(500);
    await click(page, page.getByRole("button", { name: /^Cash out to USDC$/ }));
    mark("fhe cashout clicked");
    await page.getByText(/Cashed out|Nothing cashed out/).first().waitFor({ timeout: 300000 });
    mark("fhe cashed out");
    await sleep(4000);
  }

  if (want("attest")) {
    await gotoNav("Attestations");
    await page.waitForURL(/\/attestations/);
    mark("attest");
    await sleep(3500);
    await moveTo(page, 700, 500, 800);
    await smoothScroll(page, 380, 1800);
    await sleep(4000);
    mark("attest end");
  }

  if (want("receive")) {
    await gotoNav("Receive");
    await page.waitForURL(/\/receive/);
    mark("receive");
    await connect();
    await unlock();
    await sleep(800);
    await click(page, page.getByRole("button", { name: /^Scan$/ }));
    mark("receive scan");
    await page.getByText(/Inbox · [1-9]/).waitFor({ timeout: 900000 });
    mark("receive found");
    await sleep(3000);
    await smoothScroll(page, 300, 1200);
    await sleep(1500);
    const rev = page.getByRole("button", { name: /^Reveal$/ }).first();
    await click(page, rev);
    mark("receive reveal clicked");
    await page.getByRole("button", { name: /^Move to balance$/ }).first().waitFor({ timeout: 120000 });
    await sleep(2500);
    mark("receive revealed");
    await click(page, page.getByRole("button", { name: /^Move to balance$/ }).first());
    mark("receive move clicked");
    await page.getByText(/Moved to your private balance/i).waitFor({ timeout: 240000 });
    mark("receive moved");
    await sleep(4000);
  }

  if (want("plugin")) {
    await gotoNav("Plugin");
    await page.waitForURL(/\/developers/);
    await page.getByText("Try the widget").first().waitFor({ timeout: 20000 });
    await page.evaluate(() => { const e = [...document.querySelectorAll("h2,h3,div,span")].find((n) => n.textContent?.trim() === "Try the widget"); if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 70); });
    await sleep(1500);
    mark("plugin");
    await moveTo(page, 420, 520, 900);
    await sleep(2500);
    await hover(page, page.getByText(/KakushiPay/).first(), 900).catch(() => {});
    await sleep(3000);
    await smoothScroll(page, 420, 1800);
    await sleep(3500);
    mark("plugin end");
  }
} catch (e) {
  mark("ERROR", { message: e.message.slice(0, 300) });
  await page.screenshot({ path: path.join(WORK, OUT + ".error.png") });
} finally {
  const secs = await cap.stop();
  mark("stop", { secs });
  await browser.close();
}
