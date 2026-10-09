// Renders the film's title cards and captions as transparent 1440x900 PNGs, in the site's
// own type (Shippori Mincho + Zen Kaku Gothic), with Playwright.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Card {
  id: string;
  kind: "title" | "caption" | "end";
  /** captions over the receipt scenes sit at the top, so the timeline stays readable */
  top?: boolean;
  title: string;
  sub?: string;
}

export const CARDS: Card[] = [
  { id: "title", kind: "title", title: "Kakushi", sub: "The bridge with a hidden destination" },
  { id: "c-amount", kind: "caption", title: "The last four digits of the amount are the destination.", sub: "9001 is Monad. No memo, no approval, no wrapped token." },
  { id: "c-quotes", kind: "caption", title: "Competing Makers quote. The hub checks every quote.", sub: "Each one shows the margin that backs it on Monad." },
  { id: "c-pay", kind: "caption", top: true, title: "You pay the Maker directly.", sub: "A plain USDC transfer on Sepolia." },
  { id: "c-paid", kind: "caption", top: true, title: "Paid out on Monad about a second later.", sub: "Through a PayoutRouter that logs every payout." },
  { id: "c-outage", kind: "caption", top: true, title: "Now a Maker goes offline and doesn't pay.", sub: "12 USDC sent to Maker A, which never fills." },
  { id: "c-ff", kind: "caption", top: true, title: "Fill window closes. Chainlink CRE attests the windows.", sub: "A Watchtower proves the missing payout in Noir. (fast-forward)" },
  { id: "c-slashed", kind: "caption", top: true, title: "Proven on Monad. The Maker's margin pays you back.", sub: "Verified and slashed in one transaction." },
  { id: "c-disputes", kind: "caption", title: "Every dispute is public, and anyone can prove one.", sub: "Including you, in your browser." },
  { id: "c-attest", kind: "caption", title: "Every payout of every block window, attested.", sub: "Contiguous windows, so nothing can be left out." },
  { id: "c-makers", kind: "caption", title: "A permissionless market of Makers.", sub: "Margin, fills, latency and slashes, in the open." },
  { id: "c-refund", kind: "caption", top: true, title: "Mistyped the code? It is refunded, never lost.", sub: "9999 isn't a route, so the Maker must return it." },
  { id: "end", kind: "end", title: "Kakushi", sub: "github.com/nickthelegend/kakushi" },
];

const FONTS = "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@700;800&family=Zen+Kaku+Gothic+New:wght@400;500&display=block";

function html(c: Card): string {
  const base = `<link rel="stylesheet" href="${FONTS}"><style>
    html,body{margin:0;width:1440px;height:900px;background:transparent;overflow:hidden}
    .mincho{font-family:'Shippori Mincho',serif;font-weight:800;color:#ede6d6}
    .gothic{font-family:'Zen Kaku Gothic New',sans-serif;color:#c9c3b6}
    .seal{display:inline-grid;place-items:center;width:84px;height:84px;border:4px solid #e8452c;border-radius:12px;color:#e8452c;font-family:'Shippori Mincho',serif;font-weight:800;font-size:52px;box-shadow:inset 0 0 0 4px rgba(232,69,44,.18)}
  </style>`;
  if (c.kind === "caption") {
    const band = c.top
      ? `<div style="position:absolute;left:0;right:0;top:0;height:250px;background:linear-gradient(180deg,rgba(11,20,36,.97) 45%,rgba(11,20,36,0))"></div>`
      : `<div style="position:absolute;left:0;right:0;bottom:0;height:230px;background:linear-gradient(0deg,rgba(11,20,36,.94) 35%,rgba(11,20,36,0))"></div>`;
    return `${base}${band}
      <div style="position:absolute;left:72px;${c.top ? "top:46px" : "bottom:58px"};max-width:1150px">
        <div class="mincho" style="font-size:40px;line-height:1.2">${c.title}</div>
        ${c.sub ? `<div class="gothic" style="font-size:22px;margin-top:10px">${c.sub}</div>` : ""}
      </div>`;
  }
  const tagline = c.kind === "end" ? "Built on Monad, with Chainlink CRE, Noir, Privy and Envio." : "";
  return `${base}<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 55%,rgba(11,20,36,.55),rgba(11,20,36,.9))"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div style="display:flex;align-items:center;gap:26px"><span class="seal">隠</span><span class="mincho" style="font-size:96px">${c.title}</span></div>
      ${c.sub ? `<div class="gothic" style="font-size:30px">${c.sub}</div>` : ""}
      ${tagline ? `<div class="gothic" style="font-size:22px;color:#a3a8b8">${tagline}</div>` : ""}
    </div>`;
}

export async function renderCards(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const c of CARDS) {
    await page.setContent(html(c), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${c.id}.png`, omitBackground: true });
  }
  await browser.close();
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await renderCards(process.argv[2] ?? "docs/video/raw/cards");
  console.log("cards rendered");
}
