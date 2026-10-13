// Take 4: the provider/operator tour for the walkthrough (no transactions): Shield any-token pools and private
// contract calls, Makers market, the Maker console, Explorer, Bridge Claim + disputes, Attestations, SDK snippets.
import fs from "node:fs";
import path from "node:path";
import { launch, attachWallet, loadAccount, startCapture, click, hover, moveTo, smoothScroll, sleep, WORK } from "./rec-lib.mjs";

const APP = "https://kakushi.vercel.app";
const OUT = "take4.mp4";
const acct = loadAccount();
const markers = [];
let cap = null;
const mark = (label) => { markers.push({ t: cap ? +cap.now().toFixed(2) : null, label }); console.log("MARK", label, markers.at(-1).t); fs.writeFileSync(path.join(WORK, OUT + ".markers.json"), JSON.stringify(markers, null, 2)); };
const { browser, context } = await launch();
await attachWallet(context, acct, (t) => console.log("UNEXPECTED TX", t.hash));
const page = await context.newPage();
const header = () => page.locator("header");
const gotoNav = async (name) => {
  const l = header().getByRole("link", { name, exact: true }).first();
  if (await l.isVisible().catch(() => false)) return click(page, l);
  await click(page, header().getByRole("button", { name: /More/ }).first());
  await sleep(500);
  await click(page, page.getByRole("menuitem", { name: new RegExp(name) }).first());
};
const connect = async () => {
  const b = header().getByRole("button", { name: /^Connect/ }).first();
  if (await b.isVisible().catch(() => false)) { await click(page, b); await sleep(500); await click(page, page.getByText("Browser wallet").first()); await sleep(900); }
};
await page.goto(APP + "/shield", { waitUntil: "domcontentloaded" });
await sleep(5000);
await page.mouse.move(900, 400);
cap = await startCapture(page, path.join(WORK, OUT));
try {
  mark("shield");
  await connect();
  await sleep(800);
  const tok = page.getByLabel("Token address");
  if (await tok.count()) { await hover(page, tok, 800); mark("shield any token"); await sleep(3500); }
  await click(page, page.getByRole("button", { name: /^Withdraw$/ }).first());
  await sleep(1000);
  await click(page, page.getByRole("button", { name: /^Pay privately$/ }).first());
  await sleep(2000);
  await click(page, page.getByRole("button", { name: /^Contract call$/ }).first());
  mark("shield contract call");
  await sleep(4000);
  await gotoNav("Bridge");
  await page.waitForURL(/\/bridge/);
  await sleep(2000);
  mark("bridge claim");
  await click(page, page.getByRole("button", { name: /^Claim$/ }).first()).catch(() => {});
  await sleep(4500);
  await gotoNav("Claim");
  await page.waitForURL(/\/disputes/);
  mark("disputes");
  await sleep(3000);
  await smoothScroll(page, 400, 1800);
  await sleep(3500);
  await gotoNav("Makers");
  await page.waitForURL(/\/market/);
  mark("market");
  await sleep(5000);
  await smoothScroll(page, 450, 1800);
  await sleep(3500);
  await page.goto(APP + "/maker", { waitUntil: "domcontentloaded" });
  mark("maker console");
  await sleep(1500);
  await connect();
  await sleep(4000);
  await smoothScroll(page, 450, 1800);
  await sleep(3000);
  await gotoNav("Explorer");
  await page.waitForURL(/\/explorer/);
  mark("explorer");
  await sleep(5000);
  await smoothScroll(page, 400, 1800);
  await sleep(3000);
  await gotoNav("Attestations");
  await page.waitForURL(/\/attestations/);
  mark("attestations");
  await sleep(5000);
  await smoothScroll(page, 400, 1800);
  await sleep(3500);
  await gotoNav("Plugin");
  await page.waitForURL(/\/developers/);
  await page.getByText("Try the widget").first().waitFor({ timeout: 20000 });
  await page.evaluate(() => { const e = [...document.querySelectorAll("h2,h3,div,span")].find((n) => n.textContent?.trim() === "Try the widget"); if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY + 420); });
  await sleep(1200);
  mark("sdk snippets");
  for (const tab of ["Shield", "Widget"]) {
    await click(page, page.locator("main").getByRole("button", { name: tab, exact: true }).last()).catch(() => {});
    await sleep(3500);
  }
  mark("end");
} catch (e) {
  mark("ERROR " + e.message.slice(0, 200));
  await page.screenshot({ path: path.join(WORK, OUT + ".error.png") });
} finally {
  await cap.stop();
  mark("stop");
  await browser.close();
}
