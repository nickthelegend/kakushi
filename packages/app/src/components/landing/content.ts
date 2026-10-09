/**
 * Kakushi landing copy. Figures in worked examples are pure arithmetic from the published
 * fee formula (no clock), so the server and the browser render the same page.
 */

export const nav = {
  links: [
    { label: "Converters", href: "#how" },
    { label: "Plugin", href: "#developers" },
    { label: "Chains", href: "#chains" },
    { label: "Compare", href: "#compare" },
    { label: "FAQ", href: "#faq" },
  ],
};

export const hero = {
  eyebrow: "Kakushi",
  pill: "The privacy plugin for Monad",
  headline: ["Make anything", "private."],
  sub: "Kakushi plugs into any token, any contract and any app on Monad and turns it private: stealth payments, a zero-knowledge pool and private calls, in one SDK.",
  primary: "Add privacy",
  secondary: "Open the app",
  trust: ["Proofs made in your browser", "No custodian, no mixer operator", "Monad first, every chain next"],
};

export const sponsors = {
  pill: "Built on Monad with Noir, Chainlink CRE, Privy, Envio and Cleanverse",
  items: [{ name: "Monad" }, { name: "Noir" }, { name: "Barretenberg" }, { name: "Chainlink CRE" }, { name: "Privy" }, { name: "Envio" }, { name: "Cleanverse" }, { name: "Circle USDC" }],
} as const;

export const how = {
  eyebrow: "Converters",
  heading: ["Four converters.", "Everything goes private."],
  sub: "Plug one in, or all four. Your users keep their keys; proofs run in their browser.",
  cards: [
    { key: "token", title: "Any token", body: "Anyone opens a private pool for any token. No listing.", foot: "Pool factory" },
    { key: "call", title: "Any contract call", body: "Pay, mint or swap from the pool. No wallet link.", foot: "Private calls" },
    { key: "pay", title: "Any payment", body: "Every payment lands on a one-time address.", foot: "Stealth + widget" },
    { key: "chain", title: "Any chain", body: "Cross to Monad and land on a stealth address.", foot: "Private bridge" },
  ],
} as const;

export const proof = {
  eyebrow: "Safe by design",
  heading: ["If a Maker fails,", "its margin pays you."],
  sub: "Every Maker posts margin on Monad before it can quote. Chainlink CRE commits each payout to the hub, so a missing one can be proven with a zero-knowledge proof, in your browser, and Monad pays you from that margin in the same transaction.",
  stats: [
    { value: 0.6, suffix: " s", decimals: 1, label: "Monad finality for the hub" },
    { value: 100, suffix: "%", decimals: 0, label: "of what you sent, back from margin" },
    { value: 0, decimals: 0, label: "operators you have to trust" },
  ],
  flow: [
    { title: "You pay 12.009001 USDC", body: "To a Maker on Sepolia. The hub says it owes you 11.94 USDC on Monad within 20 s.", tag: "0 s" },
    { title: "The deadline passes", body: "No compliant payout. The Watchtower notices, or you do.", tag: "20 s" },
    { title: "Chainlink CRE attests", body: "Every payout of the block windows around the deadline, as one root each, contiguous.", tag: "CRE" },
    { title: "Noir proves, Monad slashes", body: "The proof shows your payment exists and no payout does. Margin pays you 12.009001 USDC.", tag: "1 tx" },
  ],
  maker: {
    title: "What backs Maker B",
    note: "Read from the MDC and EBC on Monad. Withdrawals wait out every fill, attestation and dispute window.",
    rows: [
      { text: "Margin posted on Monad", value: "2,000 USDC", pct: 100 },
      { text: "Required (1.1 × largest route limit)", value: "550 USDC", pct: 28 },
      { text: "Largest route limit", value: "500 USDC", pct: 25 },
      { text: "Open disputes", value: "0", pct: 0 },
    ],
  },
};

export const developers = {
  eyebrow: "Developers",
  heading: ["One plugin.", "Any app, private."],
  sub: "Drop in the widget, or call the SDK. A relayer pays the gas so nothing links back to your users' wallets.",
  bullets: ["<KakushiPay/> for checkouts", "Private calls into any contract", "A private pool for any token"],
  note: "@kakushi/sdk",
  samples: [
    {
      key: "send",
      label: "Send",
      filename: "send.ts",
      language: "ts",
      code: `import { generateStealthAddress } from "@kakushi/sdk";

// The recipient's meta-address, from the registry or a QR code
const { stealthAddress, ephemeralPublicKey, viewTag } =
  generateStealthAddress(recipientMetaAddress);

// One transaction: pay the one-time address and announce it
await stealthPay.write.sendNative(
  [stealthAddress, ephemeralPublicKey, viewTag],
  { value: parseEther("0.1") },
);`,
    },
    {
      key: "prove",
      label: "Shield",
      filename: "shield.ts",
      language: "ts",
      code: `import { createNote, buildWithdraw } from "@kakushi/sdk";

// Deposit: only the commitment goes on chain
const note = createNote({ chainId: 10143, pool });
await pool.write.deposit([note.commitment], { value: parseEther("1") });

// Later, from any wallet: a proof, sent by the relayer
const req = await buildWithdraw(note, { recipient: fresh, relayer });
await fetch(relayerUrl + "/relay", { method: "POST", body: JSON.stringify(req) });`,
    },
    {
      key: "maker",
      label: "Widget",
      filename: "Checkout.tsx",
      language: "tsx",
      code: `import { KakushiPay } from "@kakushi/widget";

// Drop it next to your existing pay button
<KakushiPay
  to={merchantMetaAddress}
  amount="25"
  token="USDC"
  chain="monad"
  onPaid={(tx) => markOrderPaid(tx)}
/>`,
    },
  ],
};

export const makers = {
  eyebrow: "Makers",
  heading: ["Run a Maker.", "Power private transfers."],
  sub: "Makers set their own fees and limits per route, post margin on Monad, and fill from their own wallets. The fastest, cheapest, best-backed quote wins the transfer.",
  bullets: [
    { title: "Your fees, your routes", body: "A flat withholding plus basis points, per route. Changes take effect after a delay, so open quotes stay honest." },
    { title: "Margin, not a vault", body: "Post at least 1.1× your largest route limit. Users see it on every quote." },
    { title: "Timelocked withdrawals", body: "Withdrawals wait out every fill, attestation and dispute window, and never go below what's required." },
  ],
};

export const fees = {
  eyebrow: "Fees",
  line: "Free to integrate. Gas, and a relayer fee you can see.",
  sub: "No protocol cut. A withdrawal pays its relayer a fixed fee shown before you sign; or send it yourself and pay only gas.",
  compare: "Open source, MIT. No API key.",
};

export const faq = {
  eyebrow: "FAQ",
  heading: ["Questions,", "answered."],
  sub: "About keys, proofs and what stays public.",
  items: [
    { q: "What does a stealth address hide?", a: "Who gets paid. Each payment goes to a fresh address derived from the recipient's meta-address; only their viewing key can find it. The amount and sender are still public." },
    { q: "What does the pool hide?", a: "The link between a deposit and a withdrawal. You deposit a fixed amount with a commitment and later withdraw with a zero-knowledge proof that you own one of the deposits, without saying which." },
    { q: "Who can see my keys?", a: "Nobody. Your stealth keys are derived from a signature in your own wallet, and proofs are generated in your browser." },
    { q: "Why a relayer?", a: "A fresh address has no gas. The relayer submits the withdrawal and takes a fee from it, so the new address never touches your old one." },
    { q: "Which chains?", a: "Monad testnet first, then Sepolia, Base Sepolia, Arbitrum Sepolia and OP Sepolia. The private bridge moves funds between them to stealth addresses." },
    { q: "What about compliance?", a: "Pools are fixed-size and every proof is public on chain. A compliant lane with Cleanverse checks is available for apps that need it." },
  ],
};

export const closing = {
  heading: "Plug in privacy.",
  sub: "Any token, any call, any payment, any chain: private on Monad.",
};

export const chains = {
  eyebrow: "Chains",
  heading: ["Monad first.", "Every chain next."],
  sub: "The same contracts at the same address on every chain. Private transfers between them run through Makers to stealth addresses.",
};
