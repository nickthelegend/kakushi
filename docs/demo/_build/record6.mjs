// Bounty footage: (1) a real-speed xterm.js replay of a captured CLI run (work/<name>.json from capture_cli.py),
// (2) a live MonadVision page. Usage: node record6.mjs term <capture.json> <out.mp4> "<title>" | node record6.mjs web <url> <out.mp4> <secs>
import fs from "node:fs";
import path from "node:path";
import { launch, startCapture, moveTo, smoothScroll, sleep, WORK } from "./rec-lib.mjs";
const [mode, src, out, extra] = process.argv.slice(2);
const { browser, context } = await launch();
const page = await context.newPage();
if (mode === "term") {
  const cap = JSON.parse(fs.readFileSync(src, "utf8"));
  const chunks = cap.chunks.filter((c) => !/Update available|cre update|github\.com/i.test(c.d));
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<style>html,body{margin:0;height:100%;background:#04060f;font-family:-apple-system,system-ui,sans-serif}
.bloom{position:fixed;inset:0;background:radial-gradient(70% 55% at 50% -5%,rgba(47,71,245,.30),transparent 70%)}
.win{position:absolute;left:40px;top:40px;right:40px;bottom:96px;border-radius:14px;background:#0a0e1c;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(59,85,255,.35);overflow:hidden}
.bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#11162a;color:#9aa3c7;font-size:13px}
.dot{width:12px;height:12px;border-radius:50%}.t{flex:1;text-align:center;margin-right:60px}
#term{position:absolute;left:18px;right:18px;top:52px;bottom:12px}</style></head><body><div class="bloom"></div>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="t">${extra}</span></div><div id="term"></div></div>
<script>
const term = new Terminal({ cols: 118, rows: 33, fontSize: 17, fontFamily: 'Menlo, monospace', theme: { background: '#0a0e1c', foreground: '#e6e9f5' }, convertEol: true });
term.open(document.getElementById('term'));
window.__play = async (cmd, chunks) => {
  if (cmd) { term.write('\\x1b[38;5;75mkakushi/packages/cre\\x1b[0m \\x1b[38;5;220m$\\x1b[0m ');
  for (const ch of cmd) { term.write(ch); await new Promise(r => setTimeout(r, 28)); }
  await new Promise(r => setTimeout(r, 450)); term.write('\\r\\n'); }
  const t0 = performance.now();
  for (const c of chunks) { const w = c.t - (performance.now() - t0); if (w > 0) await new Promise(r => setTimeout(r, w)); term.write(c.d); }
  return Math.round(performance.now() - t0);
};
</script></body></html>`;
  const f = path.join(WORK, "term.html");
  fs.writeFileSync(f, html);
  await page.goto("file://" + f);
  await page.waitForFunction(() => window.__play);
  await sleep(800);
  const c = await startCapture(page, path.join(WORK, out));
  await sleep(700);
  const ms = await page.evaluate(([cmd, ch]) => window.__play(cmd, ch), [cap.command.startsWith('sh ') ? '' : cap.command, chunks]);
  console.log("replayed", ms, "ms, capture t", c.now());
  await sleep(4000);
  console.log("secs", await c.stop());
} else {
  await page.goto(src, { waitUntil: "domcontentloaded" });
  await sleep(16000);
  for (const name of [/^Reject/i, /^Decline/i, /Only necessary/i, /^Accept/i]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible().catch(() => false)) { if (!/Accept/.test(String(name))) { await b.click(); break; } }
  }
  await page.mouse.move(700, 300);
  const c = await startCapture(page, path.join(WORK, out));
  const secs = Number(extra || 14);
  await sleep(1200);
  await moveTo(page, 760, 360, 900);
  await sleep(secs * 300);
  await smoothScroll(page, 360, 1800);
  await sleep(secs * 400);
  console.log("secs", await c.stop());
  await page.screenshot({ path: path.join(WORK, out + ".png") });
}
await browser.close();
