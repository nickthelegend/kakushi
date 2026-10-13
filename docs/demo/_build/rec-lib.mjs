// Recording harness for the Kakushi demo: Chrome driven by Playwright, an injected EIP-1193 wallet whose
// key stays in Node (viem), a visible eased cursor, and a CFR 30 fps capture fed from CDP screencast frames.
// The private key never enters the page: the page only sees an address and calls a bridge function.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, defineChain, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = path.resolve(import.meta.dirname, "../../..");
export const WORK = path.join(import.meta.dirname, "work");
fs.mkdirSync(WORK, { recursive: true });

const CHAINS = {
  10143: defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } } }),
  11155111: defineChain({ id: 11155111, name: "Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } } }),
};

export function loadAccount() {
  const { pk } = JSON.parse(fs.readFileSync(path.join(ROOT, ".stack/recording-wallet.json"), "utf8"));
  return privateKeyToAccount(pk);
}

export function makeBridge(account, txLog) {
  let chainId = 10143;
  let connected = false;
  const pcs = Object.fromEntries(Object.entries(CHAINS).map(([id, c]) => [id, createPublicClient({ chain: c, transport: http() })]));
  const wcs = Object.fromEntries(Object.entries(CHAINS).map(([id, c]) => [id, createWalletClient({ account, chain: c, transport: http() })]));
  const rpc = async (method, params) => {
    const r = await fetch(CHAINS[chainId].rpcUrls.default.http[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  const addr = account.address;
  const handle = async (method, params = []) => {
    switch (method) {
      case "eth_requestAccounts":
        connected = true;
        return [addr];
      case "eth_accounts":
        return connected ? [addr] : [];
      case "eth_chainId":
        return `0x${chainId.toString(16)}`;
      case "net_version":
        return String(chainId);
      case "wallet_switchEthereumChain": {
        const id = Number(params[0].chainId);
        if (!CHAINS[id]) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        chainId = id;
        return null;
      }
      case "wallet_addEthereumChain": {
        const id = Number(params[0].chainId);
        if (!CHAINS[id]) throw Object.assign(new Error("Chain not supported by the recording wallet"), { code: 4001 });
        chainId = id;
        return null;
      }
      case "wallet_getPermissions":
      case "wallet_requestPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "personal_sign": {
        const msg = String(params[0]).toLowerCase() === addr.toLowerCase() ? params[1] : params[0];
        return account.signMessage({ message: { raw: msg } });
      }
      case "eth_signTypedData_v4": {
        const td = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        const { EIP712Domain, ...types } = td.types;
        return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
      }
      case "eth_sendTransaction": {
        const tx = params[0];
        const pc = pcs[chainId];
        const req = { account, to: tx.to, data: tx.data, value: tx.value ? hexToBigInt(tx.value) : 0n };
        let gas = tx.gas ? hexToBigInt(tx.gas) : null;
        if (!gas) gas = ((await pc.estimateGas(req)) * 115n) / 100n; // Monad bills the limit: estimate + 15%
        const t0 = Date.now();
        const hash = await wcs[chainId].sendTransaction({ ...req, gas });
        const entry = { chainId, hash, to: tx.to, value: req.value.toString(), gas: gas.toString(), at: new Date(t0).toISOString() };
        txLog(entry);
        (async () => {
          for (let i = 0; i < 3000; i++) {
            const r = await pc.getTransactionReceipt({ hash }).catch(() => null);
            if (r) { Object.assign(entry, { receiptMs: Date.now() - t0, status: r.status, gasUsed: r.gasUsed.toString(), block: r.blockNumber.toString() }); txLog(entry); return; }
            await new Promise((res) => setTimeout(res, 50));
          }
        })();
        return hash;
      }
      default:
        return rpc(method, params);
    }
  };
  return async (json) => {
    const { method, params } = JSON.parse(json);
    try {
      return JSON.stringify({ ok: await handle(method, params) }, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
    } catch (e) {
      return JSON.stringify({ err: { code: e.code ?? -32603, message: e.shortMessage ?? e.message } });
    }
  };
}

// Page side: an EIP-1193 provider (window.ethereum + EIP-6963 announce) and the overlay cursor.
const INIT = `(() => {
  const listeners = {};
  const emit = (ev, v) => (listeners[ev] || []).forEach((f) => { try { f(v); } catch {} });
  const provider = {
    isKakushiRecordingWallet: true,
    async request({ method, params }) {
      const r = JSON.parse(await window.__kkWallet(JSON.stringify({ method, params })));
      if (r.err) { const e = new Error(r.err.message); e.code = r.err.code; throw e; }
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") emit("chainChanged", params[0].chainId);
      if (method === "eth_requestAccounts") emit("accountsChanged", r.ok);
      return r.ok;
    },
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); return provider; },
    removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter((g) => g !== f); return provider; },
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  const info = { uuid: "5b0e3c1e-7d2a-4d6e-9a51-6c1f0b5e2d11", name: "Recording wallet", rdns: "app.kakushi.recording",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyByeD0nOCcgZmlsbD0nIzJmNDdmNScvPjwvc3ZnPg==" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // the cursor: follows real mouse events, so hover states and the drawn pointer agree
  let x = window.__kkX ?? 960, y = window.__kkY ?? 540;
  const make = () => {
    if (document.getElementById("__kkcur")) return;
    const c = document.createElement("div");
    c.id = "__kkcur";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.4 L11.7 22 L14.6 20.7 L11.6 14.3 L17.8 14.3 Z" fill="#fff" stroke="#04060f" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const st = (el, o) => Object.entries(o).forEach(([k, v]) => el.style.setProperty(k, v));
    st(c, { position: "fixed", left: "0", top: "0", width: "30px", height: "30px", "pointer-events": "none", "z-index": "2147483647", transform: "translate(" + (x - 4) + "px," + (y - 2) + "px)" });
    const r = document.createElement("div");
    r.id = "__kkring";
    st(r, { position: "fixed", left: "0", top: "0", width: "44px", height: "44px", margin: "-22px 0 0 -22px", "border-radius": "50%", border: "3px solid #f2c27a", "pointer-events": "none", "z-index": "2147483646", opacity: "0", transform: "translate(" + x + "px," + y + "px) scale(.4)" });
    document.documentElement.appendChild(r);
    document.documentElement.appendChild(c);
  };
  const place = () => {
    const c = document.getElementById("__kkcur");
    if (c) c.style.transform = "translate(" + (x - 4) + "px," + (y - 2) + "px)";
  };
  window.addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; window.__kkX = x; window.__kkY = y; make(); place(); }, true);
  window.addEventListener("mousedown", () => {
    make();
    const r = document.getElementById("__kkring");
    if (!r) return;
    r.animate([{ opacity: 0.95, transform: "translate(" + x + "px," + y + "px) scale(.4)" }, { opacity: 0, transform: "translate(" + x + "px," + y + "px) scale(1.25)" }], { duration: 520, easing: "cubic-bezier(.2,.7,.2,1)" });
  }, true);
  const boot = () => { make(); setInterval(make, 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();`;

export async function launch({ width = 1536, height = 864, scale = 1.25 } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: "dark", locale: "en-US", timezoneId: "Asia/Kolkata" });
  return { browser, context };
}

export async function attachWallet(context, account, txLog) {
  await context.exposeFunction("__kkWallet", makeBridge(account, txLog));
  await context.addInitScript(INIT);
}

// CFR capture: the latest screencast frame is written to ffmpeg at 30 fps of wall-clock time.
export async function startCapture(page, out, { fps = 30, w = 1920, h = 1080 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  let last = null;
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-vf", `scale=${w}:${h}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-g", "60", out], { stdio: ["pipe", "inherit", "inherit"] });
  cdp.on("Page.screencastFrame", async (f) => {
    last = Buffer.from(f.data, "base64");
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
  while (!last) await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now();
  let n = 0;
  let stopped = false;
  const tick = setInterval(() => {
    if (stopped) return;
    const want = Math.floor(((Date.now() - t0) / 1000) * fps);
    while (n < want) { ff.stdin.write(last); n++; }
  }, 1000 / fps / 2);
  return {
    t0,
    now: () => (Date.now() - t0) / 1000,
    async stop() {
      stopped = true;
      clearInterval(tick);
      await cdp.send("Page.stopScreencast").catch(() => {});
      ff.stdin.end();
      await new Promise((r) => ff.on("close", r));
      return n / fps;
    },
  };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let cur = { x: 768, y: 432 };

export async function moveTo(page, x, y, ms = 750) {
  const steps = Math.max(12, Math.round(ms / 16));
  const from = { ...cur };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = Math.min(ms, 260 + dist * 0.9);
  const t0 = Date.now();
  for (let i = 1; i <= steps; i++) {
    const target = t0 + (dur * i) / steps;
    const k = ease(i / steps);
    // a slight arc reads as a hand, not a robot
    const arc = Math.sin(Math.PI * (i / steps)) * Math.min(40, dist * 0.08);
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k - arc);
    const wait = target - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  cur = { x, y };
}

export async function center(loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function hover(page, loc, ms) {
  const c = await center(loc);
  await moveTo(page, c.x, c.y, ms);
}

export async function click(page, loc, { pause = 180, ms } = {}) {
  await loc.waitFor({ state: "visible", timeout: 60000 });
  const c = await center(loc);
  await moveTo(page, c.x, c.y, ms);
  await sleep(pause);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}

export async function typeInto(page, loc, text, { delay = 55 } = {}) {
  await click(page, loc);
  await loc.fill("");
  await page.keyboard.type(text, { delay });
}

export async function smoothScroll(page, dy, ms = 1200) {
  await page.evaluate(([dy, ms]) => new Promise((res) => {
    const y0 = window.scrollY, t0 = performance.now();
    const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const f = (now) => { const k = Math.min(1, (now - t0) / ms); window.scrollTo(0, y0 + dy * e(k)); k < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
  }), [dy, ms]);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
