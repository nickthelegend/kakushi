// The take: the live app on Monad testnet (+ Sepolia payout), RECORDING-RUNBOOK steps 1-9.
// Off camera first: connect the recording wallet, unlock stealth keys, warm the backends.
// Writes work/capture.mp4, work/markers.json (video-time markers) and work/txs.json (every tx, with receipt latency).
import fs from "node:fs";
import path from "node:path";
import { launch, attachWallet, loadAccount, startCapture, click, hover, moveTo, typeInto, smoothScroll, sleep, WORK } from "./rec-lib.mjs";

const APP = "https://kakushi.vercel.app";
const acct = loadAccount();
const ME = acct.address;
const txs = [];
const markers = [];
let cap = null;
const mark = (label, extra = {}) => {
  const m = { t: cap ? +cap.now().toFixed(2) : null, label, ...extra };
  markers.push(m);
  console.log("MARK", JSON.stringify(m));
  fs.writeFileSync(path.join(WORK, (process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "capture") + ".markers.json"), JSON.stringify(markers, null, 2));
};
const only = process.argv.find((a) => a.startsWith("--steps="))?.slice(8).split(",") ?? null;
const want = (s) => !only || only.includes(String(s));

const { browser, context } = await launch();
await attachWallet(context, acct, (t) => {
  if (!txs.includes(t)) txs.push(Object.assign(t, { videoT: cap ? +cap.now().toFixed(2) : null, step: markers.at(-1)?.label }));
  fs.writeFileSync(path.join(WORK, (process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "capture") + ".txs.json"), JSON.stringify(txs, null, 2));
  console.log("TX", t.hash, t.receiptMs ?? "");
});
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 160)); });
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 160)));
const nav = (name) => page.locator("header").getByRole("link", { name, exact: true }).first();
const connectIfNeeded = async () => {
  await sleep(1200);
  const b = page.locator("header").getByRole("button", { name: /^Connect/ }).first();
  if (await b.isVisible().catch(() => false)) {
    await click(page, b);
    await sleep(500);
    await click(page, page.getByText("Browser wallet").first());
    await sleep(900);
    mark("reconnected");
  }
};
const unlockIfNeeded = async () => {
  const u = page.getByRole("button", { name: /Unlock with your wallet/ });
  if (await u.isVisible().catch(() => false)) {
    await click(page, u);
    await page.getByText(/Listed on Monad/).waitFor({ timeout: 30000 });
    mark("unlocked");
    await sleep(800);
  }
};
const gotoNav = async (name) => {
  const l = nav(name);
  if (await l.isVisible().catch(() => false)) return click(page, l);
  // under "More"
  await click(page, page.locator("header").getByRole("button", { name: /More/ }).first());
  await sleep(350);
  await click(page, page.getByRole("menuitem", { name }).first());
};

// ── off camera ──────────────────────────────────────────────────────────────
await page.goto(`${APP}/bridge`, { waitUntil: "domcontentloaded" });
await sleep(6000); // Maker 1 quote warms up
await page.goto(`${APP}/confidential`, { waitUntil: "domcontentloaded" });
await sleep(5000); // FHE key (~33 KB)
await fetch("https://relayer-production-6ade.up.railway.app/health").catch(() => {});
await page.goto(`${APP}/receive`, { waitUntil: "networkidle" });
await sleep(1500);
await page.getByRole("button", { name: /Connect/ }).first().click();
await sleep(400);
await page.getByText("Browser wallet").click();
await sleep(1200);
await page.getByRole("button", { name: /Unlock with your wallet/ }).click();
await page.getByText(/Listed on Monad/).waitFor({ timeout: 30000 });
console.log("wallet connected, stealth keys unlocked, listed on Monad");
// back to the landing page by the logo (client-side, the wallet stays connected)
if (want(1)) {
  await page.locator("header a[href='/']").first().click();
  await page.waitForURL(`${APP}/`);
} else {
  await page.locator("header").getByRole("link", { name: "Send", exact: true }).first().click();
}
await sleep(3500);
await page.mouse.move(1180, 420);

// ── on camera ───────────────────────────────────────────────────────────────
cap = await startCapture(page, path.join(WORK, process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? (process.argv.includes("--test") ? "capture-test.mp4" : "capture.mp4")));
mark("start");
try {
  if (want(1)) {
    mark("1 landing");
    await moveTo(page, 1000, 450, 900);
    await sleep(2500);
    const engines = page.getByText(/Two engines/i).first();
    if (await engines.count()) {
      const box = await engines.boundingBox();
      await smoothScroll(page, Math.max(0, (box?.y ?? 900) - 120), 2200);
    } else await smoothScroll(page, 900, 2200);
    mark("1 engines");
    await sleep(4500);
    await smoothScroll(page, -(await page.evaluate(() => window.scrollY)), 1200);
    await sleep(600);
    // into the app
    await click(page, page.getByRole("link", { name: "Open app" }).first());
    await page.waitForURL(/\/send/);
    await sleep(1500);
  }
  if (want(2)) {
    mark("2 pill");
    const pill = page.locator("header").getByText(/final in|Monad testnet/i).last();
    await hover(page, pill, 900);
    await sleep(5500);
    mark("2 pill end");
    await moveTo(page, 800, 500, 700);
  }
  if (want(3)) {
    if (!page.url().includes("/send")) { await gotoNav("Send"); await sleep(1500); }
    mark("3 send");
    await typeInto(page, page.getByLabel("Recipient meta-address or wallet"), ME, { delay: 18 });
    await page.getByText("Private address found").waitFor({ timeout: 20000 });
    mark("3 found");
    await sleep(700);
    const amt = page.getByLabel(/^Amount of MON/);
    await click(page, amt);
    await amt.fill("");
    await page.keyboard.type("0.01", { delay: 120 });
    await sleep(600);
    await click(page, page.getByRole("button", { name: /Send privately/ }));
    mark("3 clicked");
    await page.getByText(/^Sent 0\.01 MON/).waitFor({ timeout: 60000 });
    mark("3 done");
    await sleep(3500);
  }
  if (want(4)) {
    await gotoNav("Receive");
    await page.waitForURL(/\/receive/);
    mark("4 receive");
    await sleep(1500);
    await click(page, page.getByRole("button", { name: /^Scan$/ }));
    mark("4 scan");
    await page.getByText(/Inbox · [1-9]/).waitFor({ timeout: 400000 });
    mark("4 found");
    await sleep(3500);
  }
  if (want(5)) {
    await gotoNav("Confidential");
    await page.waitForURL(/\/confidential/);
    mark("5 confidential");
    await connectIfNeeded();
    await sleep(1200);
    const amt = page.getByLabel(/^Amount of USDC/).first();
    await click(page, amt);
    await amt.fill("");
    await page.keyboard.type("1", { delay: 120 });
    await sleep(500);
    await click(page, page.getByRole("button", { name: /^Make private$/ }).last());
    mark("5 wrap clicked");
    await page.getByText(/is now private/).first().waitFor({ timeout: 180000 });
    mark("5 wrap done");
    await sleep(2500);
    await click(page, page.getByRole("button", { name: /^Reveal$/ }).first());
    mark("5 reveal clicked");
    await page.getByText("Visible in this tab only").waitFor({ timeout: 90000 });
    mark("5 revealed");
    await sleep(3500);
  }
  if (want(6)) {
    await click(page, page.getByRole("tab", { name: /^Pay$/ }));
    mark("6 pay");
    await sleep(1200);
    await click(page, page.getByRole("button", { name: /^Private recipient$/ }).first()).catch(() => {});
    await typeInto(page, page.getByLabel("Recipient meta-address or wallet"), ME, { delay: 18 });
    await sleep(900);
    const amt = page.getByLabel(/^Amount of cUSDC|^Amount of/).last();
    await click(page, amt);
    await amt.fill("");
    await page.keyboard.type("0.3", { delay: 120 });
    await sleep(600);
    await click(page, page.getByRole("button", { name: /^Pay privately$/ }));
    mark("6 pay clicked");
    await page.getByText(/^Sent 0\.3/).first().waitFor({ timeout: 180000 });
    mark("6 done");
    await sleep(4000);
  }
  if (want(7)) {
    await gotoNav("Receive");
    await page.waitForURL(/\/receive/);
    mark("7 receive");
    await connectIfNeeded();
    await unlockIfNeeded();
    await sleep(800);
    await click(page, page.getByRole("button", { name: /^Scan$/ }));
    await page.getByRole("button", { name: /^Reveal$/ }).first().waitFor({ timeout: 400000 });
    mark("7 found");
    await sleep(2000);
    await click(page, page.getByRole("button", { name: /^Reveal$/ }).first());
    mark("7 reveal clicked");
    await page.getByRole("button", { name: /^Move to balance$/ }).first().waitFor({ timeout: 90000 });
    await page.waitForFunction(() => /0\.3/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
    mark("7 revealed");
    await sleep(2500);
    await click(page, page.getByRole("button", { name: /^Move to balance$/ }).first());
    mark("7 move clicked");
    await page.getByText(/Moved to your private balance/i).waitFor({ timeout: 150000 });
    mark("7 moved");
    await sleep(3500);
  }
  if (want(8)) {
    await gotoNav("Bridge");
    await page.waitForURL(/\/bridge/);
    mark("8 bridge");
    await sleep(2500);
    // route chosen in --steps prep (see bridgeRoute below)
    await bridgeRoute();
    const amt = page.getByLabel(/^Amount of USDC to send/);
    await click(page, amt);
    await amt.fill("");
    await page.keyboard.type("0.5", { delay: 140 });
    mark("8 amount");
    await page.getByText(/Maker 1/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(3000);
    const btn = page.locator("main").getByRole("button", { name: /^Bridge|^Send|^Transfer/ }).last();
    await click(page, btn);
    mark("8 clicked");
    await page.waitForURL(/\/tx\//, { timeout: 120000 });
    mark("8 tx page");
    await page.getByText(/Paid out|Payout arrived/i).first().waitFor({ timeout: 240000 }).catch(() => console.log("fill text not matched"));
    mark("8 filled");
    await sleep(5000);
  }
  if (want(9)) {
    await gotoNav("Plugin");
    await page.waitForURL(/\/developers/);
    // jump past the Install card (it carries the repo URL, which stays out of the video), then hold on the widget
    await page.getByText("Try the widget").first().waitFor({ timeout: 20000 });
    await page.evaluate(() => { const e = [...document.querySelectorAll("h2,h3,div,span")].find((n) => n.textContent?.trim() === "Try the widget"); if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 70); });
    await sleep(1500);
    mark("9 plugin");
    await moveTo(page, 420, 520, 900);
    await sleep(1500);
    await hover(page, page.getByText("<KakushiPay").first().or(page.getByText(/KakushiPay/).first()), 900).catch(() => {});
    await sleep(3500);
    await smoothScroll(page, 420, 1800);
    await sleep(3500);
    mark("9 end");
  }
} catch (e) {
  mark("ERROR", { message: e.message.slice(0, 300) });
  await page.screenshot({ path: path.join(WORK, "error.png") });
} finally {
  const secs = await cap.stop();
  mark("stop", { secs });
  fs.writeFileSync(path.join(WORK, (process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "capture") + ".txs.json"), JSON.stringify(txs, null, 2));
  await browser.close();
}

async function bridgeRoute() {
  // the page opens on Sepolia -> Monad; flip it to Monad -> Sepolia
  const from = page.locator("main").getByText(/^From$/).first().locator("xpath=..");
  if (!/Monad/.test(await from.innerText().catch(() => ""))) {
    await click(page, page.getByRole("button", { name: "Swap direction" }));
    await sleep(1500);
  }
}
