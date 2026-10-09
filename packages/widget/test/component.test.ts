// Server-render smoke test: markup, semantics and theming without a DOM.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createPublicClient, createWalletClient, custom } from "viem";
import { KakushiPay, themeVars } from "../src/index.ts";

const transport = custom({ request: async () => null });
const publicClient = createPublicClient({ transport });
const walletClient = createWalletClient({ account: "0x1111111111111111111111111111111111111111", transport });
const deployment = { stealthPay: "0x3333333333333333333333333333333333333333" } as const;
const to = "st:eth:0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817980279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

describe("<KakushiPay />", () => {
  it("renders a real button with a polite status region", () => {
    const html = renderToStaticMarkup(createElement(KakushiPay, { to, amount: 1n, walletClient, publicClient, deployment, label: "Pay 5 MON privately" }));
    expect(html).toMatch(/<button type="button" class="kakushi-pay__button"[^>]*aria-describedby="[^"]+"/);
    expect(html).toContain("Pay 5 MON privately");
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toContain('data-status="idle"');
    expect(html).toContain("--kakushi-accent, #2f47f5");
  });

  it("is disabled and says why without a wallet", () => {
    const html = renderToStaticMarkup(createElement(KakushiPay, { to, amount: 1n, walletClient: null, publicClient, deployment }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("Connect a wallet to pay.");
  });

  it("applies only the theme variables it is given", () => {
    expect(themeVars({ accent: "#0a7", radius: "8px" })).toEqual({ "--kakushi-accent": "#0a7", "--kakushi-radius": "8px" });
    const html = renderToStaticMarkup(createElement(KakushiPay, { to, amount: 1n, walletClient, publicClient, deployment, theme: { accent: "#0a7" } }));
    expect(html).toContain("--kakushi-accent:#0a7");
  });
});
