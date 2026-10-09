// Records the product half of the Kakushi film against the running local stack
// (pnpm demo --keep + the app on :3710). Real UI, real transactions on the local forks,
// real proofs. Writes docs/video/raw/product.webm and scene markers for scripts/cut-film.sh.
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { parseUnits, type Hex } from "viem";
import { CHAINS } from "@kakushi/config";
import { erc20Abi, publicClient, walletClient } from "@kakushi/sdk";
import { LOCAL_KEYS, localAccount } from "./local-accounts.ts";

process.env.KAKUSHI_NETWORK = "local";
const APP = process.env.APP_URL ?? "http://localhost:3710";
const OUT = "docs/video/raw";
const W = 1440, H = 900;
const t0 = Date.now();
const marks: { name: string; at: number }[] = [];
const mark = (name: string) => {
  marks.push({ name, at: (Date.now() - t0) / 1000 });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function smoothScroll(page: Page, y: number, ms = 1600) {
  await page.evaluate(({ y, ms }) => new Promise<void>((done) => {
    const start = window.scrollY, d = y - start, t = performance.now();
    const step = (n: number) => {
      const p = Math.min(1, (n - t) / ms), e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      window.scrollTo(0, start + d * e);
      p < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  }), { y, ms });
}

async function payRaw(maker: Hex, amount: bigint, code: number): Promise<Hex> {
  const user = localAccount("user");
  const w = walletClient("sepolia", LOCAL_KEYS.user, "local");
  const gross = amount - (amount % 10_000n) + BigInt(code);
  const hash = await w.writeContract({ chain: w.chain, account: user, address: CHAINS.sepolia.usdc.address, abi: erc20Abi, functionName: "transfer", args: [maker, gross] });
  await publicClient("sepolia", "local").waitForTransactionReceipt({ hash });
  return hash;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, colorScheme: "dark" });
  await ctx.addInitScript(([key]) => {
    localStorage.setItem("kakushi.wallet", JSON.stringify({ kind: "local-dev", key, label: "Local fork user (anvil #4)" }));
  }, [LOCAL_KEYS.user]);
  const page = await ctx.newPage();

  // 1. landing
  mark("landing");
  await page.goto(`${APP}/`, { waitUntil: "networkidle" });
  await sleep(7500);
  await smoothScroll(page, 900);
  await sleep(3500);
  await smoothScroll(page, 1650);
  await sleep(5000);

  // 2. a real transfer through the UI: Sepolia USDC -> Monad
  mark("bridge");
  await page.goto(`${APP}/bridge`, { waitUntil: "networkidle" });
  await page.locator("#amount").fill("");
  await sleep(400);
  await page.locator("#amount").pressSequentially("25", { delay: 180 });
  await page.getByText("Best:").waitFor({ timeout: 30_000 });
  await sleep(3500);
  mark("pay");
  await page.getByRole("button", { name: /^Pay / }).click();
  await page.waitForURL(/\/tx\//, { timeout: 60_000 });
  mark("receipt");
  await page.getByText(/Paid out/).waitFor({ timeout: 60_000 });
  mark("paid");
  await page.getByText("Attested by Chainlink CRE").waitFor({ timeout: 90_000 }).catch(() => {});
  await sleep(3500);

  // 3. a Maker that doesn't pay: Maker A is offline (stopped by the demo); pay it anyway
  mark("outage");
  const unpaid = await payRaw(localAccount("makerA").address, parseUnits("12", 6), 9001);
  await page.goto(`${APP}/tx/${CHAINS.sepolia.chainId}/${unpaid}`, { waitUntil: "networkidle" });
  await sleep(4000);
  mark("outage-wait");
  await page.getByText(/Margin slashed/).waitFor({ timeout: 240_000 });
  mark("slashed");
  await sleep(5000);

  // 4. the dispute record, the attestations, the market
  mark("disputes");
  await page.goto(`${APP}/disputes`, { waitUntil: "networkidle" });
  await sleep(4500);
  await smoothScroll(page, 700);
  await sleep(3000);
  mark("attestations");
  await page.goto(`${APP}/attestations`, { waitUntil: "networkidle" });
  await sleep(5000);
  await smoothScroll(page, 500);
  await sleep(3000);
  mark("makers");
  await page.goto(`${APP}/makers`, { waitUntil: "networkidle" });
  await sleep(6000);

  // 5. a typo is refunded, not lost
  mark("refund");
  const typo = await payRaw(localAccount("makerB").address, parseUnits("4", 6), 9999);
  await page.goto(`${APP}/tx/${CHAINS.sepolia.chainId}/${typo}`, { waitUntil: "networkidle" });
  await page.getByText("Refunded").first().waitFor({ timeout: 90_000 });
  await sleep(4500);
  mark("end");

  await page.close();
  await ctx.close();
  await browser.close();
  const vid = readdirSync(OUT).filter((f) => f.endsWith(".webm") && f !== "product.webm").sort().pop();
  if (vid) renameSync(`${OUT}/${vid}`, `${OUT}/product.webm`);
  writeFileSync(`${OUT}/markers.json`, JSON.stringify(marks, null, 2));
  console.log(`wrote ${OUT}/product.webm and markers.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
