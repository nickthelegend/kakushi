// Envio bounty take: Receive inbox scan via HyperSync (read-only; reveal is a signature, no tx), then the raw route JSON.
import fs from "node:fs";
import path from "node:path";
import { launch, attachWallet, loadAccount, startCapture, click, hover, moveTo, smoothScroll, sleep, WORK } from "./rec-lib.mjs";
const APP = "https://kakushi.vercel.app";
const markers = []; let cap = null;
const mark = (l) => { markers.push({ t: cap ? +cap.now().toFixed(2) : null, l }); console.log("MARK", l, markers.at(-1).t); fs.writeFileSync(path.join(WORK, "take7.markers.json"), JSON.stringify(markers, null, 1)); };
const { browser, context } = await launch();
await attachWallet(context, loadAccount(), (t) => console.log("UNEXPECTED TX", t.hash));
const page = await context.newPage();
await page.goto(APP + "/receive", { waitUntil: "domcontentloaded" });
await sleep(4000);
await page.mouse.move(900, 300);
cap = await startCapture(page, path.join(WORK, "take7.mp4"));
try {
  mark("start");
  await click(page, page.locator("header").getByRole("button", { name: /^Connect/ }).first());
  await sleep(500);
  await click(page, page.getByText("Browser wallet").first());
  await sleep(1000);
  await click(page, page.getByRole("button", { name: /Unlock with your wallet/ }));
  await page.getByText(/Listed on Monad/).waitFor({ timeout: 30000 });
  mark("unlocked");
  await sleep(1200);
  await click(page, page.getByRole("button", { name: /^Scan$/ }));
  mark("scan clicked");
  await page.getByText(/Inbox · [1-9]/).waitFor({ timeout: 120000 });
  mark("scan done");
  await sleep(3000);
  const rev = page.getByRole("button", { name: /^Reveal$/ }).first();
  if (await rev.count()) {
    await hover(page, rev, 800);
    await sleep(600);
    await click(page, rev);
    mark("reveal clicked");
    await page.waitForFunction(() => /0\.3/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 90000 }).catch(() => {});
    mark("revealed");
    await sleep(3500);
  }
  await smoothScroll(page, 300, 1500);
  await sleep(3000);
  mark("json");
  await page.goto(APP + "/api/announcements?chainId=10143&from=70440000", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const pp = page.getByText(/Pretty-print/i).first();
  if (await pp.count()) await pp.click().catch(() => {});
  await sleep(1000);
  await page.keyboard.press("End");
  await sleep(1500);
  await page.screenshot({ path: path.join(WORK, "take7-json.png") });
  await sleep(4000);
  mark("end");
} catch (e) {
  mark("ERROR " + e.message.slice(0, 200));
  await page.screenshot({ path: path.join(WORK, "take7.error.png") });
} finally {
  await cap.stop(); mark("stop"); await browser.close();
}
