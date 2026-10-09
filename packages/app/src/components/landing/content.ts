/**
 * Kakushi landing copy. Figures in worked examples are pure arithmetic from the published
 * fee formula (no clock), so the server and the browser render the same page.
 */

export const nav = {
  links: [
    { label: "Chains", href: "#chains" },
    { label: "Vs Orbiter", href: "#compare" },
    { label: "How it works", href: "#how" },
    { label: "Makers", href: "#makers" },
    { label: "Fees", href: "#fees" },

    { label: "FAQ", href: "#faq" },
  ],
};

export const hero = {
  eyebrow: "Kakushi bridge",
  pill: "The fast bridge for Monad",
  headline: ["Bridge to Monad", "in a second."],
  sub: "Send USDC or ETH and get it on the other chain in about a second, paid from a Maker's own liquidity. No wrapped tokens and no bridge vault. If a Maker ever fails to pay, its margin on Monad pays you instead.",
  primary: "Open the bridge",
  secondary: "Prove a missed payout",
  trust: ["About a second to Monad", "No wrapped tokens", "Every transfer backed by Maker margin"],
};

export const sponsors = {
  pill: "Built on Monad with Chainlink CRE, Noir, Privy, Envio and Cleanverse",
  items: [{ name: "Monad" }, { name: "Chainlink CRE" }, { name: "Noir" }, { name: "Barretenberg" }, { name: "Privy" }, { name: "Envio" }, { name: "Cleanverse" }, { name: "Circle USDC" }],
} as const;

export const how = {
  eyebrow: "How it works",
  heading: ["Send on one chain.", "Receive on the other."],
  sub: "No wrapping, no claim step, no approval. The amount carries the route, a Maker fills from its own inventory, and margin on Monad stands behind every transfer.",
  cards: [
    { key: "pay", title: "You pay a Maker", body: "A plain transfer to the Maker's address. The last four digits, 9001, mean Monad.", foot: "No wrapped token" },
    { key: "paid", title: "The Maker pays you", body: "From its own inventory on the other chain, through a PayoutRouter that logs every payout.", foot: "About a second to Monad" },
    { key: "proof", title: "Or the proof pays you", body: "Missing, late or short? A Noir proof over attested data slashes the Maker's margin to you.", foot: "The full amount, from margin" },
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
  heading: ["A few lines of code."],
  sub: "Quote, build the exact transfer and watch it land with the SDK. Run a Maker node, or prove a dispute from a script.",
  bullets: ["Quotes checked against the hub's own rules", "Raw transfers: no approval, no router", "Real Noir proofs from attested windows"],
  note: "@kakushi/sdk 0.1.0",
  samples: [
    {
      key: "send",
      label: "Send",
      filename: "send.ts",
      language: "ts",
      code: `import { Kakushi, buildTransferTx } from "@kakushi/sdk";

const k = new Kakushi({ network: "testnet", deployments });

// Ask the Makers; the hub re-checks every quote's arithmetic.
const [best] = await k.quote({
  srcChainId: 11155111, dstChainId: 10143,     // Sepolia -> Monad
  token: "USDC", amount: 25_000_000n, makerUrls,
});

// 25.009001 USDC: the last four digits are Monad's code.
const tx = buildTransferTx(k, {
  srcChainId: 11155111, token: USDC, maker: best.maker,
  gross: BigInt(best.gross), sender: me,
});
await wallet.sendTransaction(tx);`,
    },
    {
      key: "prove",
      label: "Prove",
      filename: "dispute.ts",
      language: "ts",
      code: `import { findSourcePayment, prepareDispute } from "@kakushi/sdk";
import { prove } from "@kakushi/attest-core/prover";

const payment = await findSourcePayment(k, 11155111, txHash);
const plan = await prepareDispute(k, payment);   // rebuilds CRE windows
if (!plan.ready) throw new Error(plan.reason);

const { proof } = await prove("payment_compliance", plan.inputs);
await dm.write.openDispute([...], { value: k.bond });
await dm.write.proveDispute([plan.claim, plan.payoutWindowIds, proof]);`,
    },
    {
      key: "maker",
      label: "Maker",
      filename: "terminal",
      language: "bash",
      code: `# Post margin and register routes in the Maker console, then:
MAKER_NAME="Maker B" MAKER_KEY=0x… MAKER_PORT=3712 \\
  node packages/maker/src/main.ts

# or sign with a Privy server wallet whose policy only allows
# PayoutRouter.fill / refund and DisputeModule.answerDispute
PRIVY_APP_ID=… PRIVY_MAKER_WALLET_ID=… node packages/maker/src/main.ts`,
    },
  ],
};

export const makers = {
  eyebrow: "Makers",
  heading: ["Earn on every transfer.", "Keep your inventory."],
  sub: "Makers set their own fees and limits per route, post margin on Monad, and fill from their own wallets. The fastest, cheapest, best-backed quote wins the transfer.",
  bullets: [
    { title: "Your fees, your routes", body: "A flat withholding plus basis points, per route. Changes take effect after a delay, so open quotes stay honest." },
    { title: "Margin, not a vault", body: "Post at least 1.1× your largest route limit. Users see it on every quote." },
    { title: "Timelocked withdrawals", body: "Withdrawals wait out every fill, attestation and dispute window, and never go below what's required." },
  ],
};

export const fees = {
  eyebrow: "Fees",
  line: "From 0.10%, plus a few cents for gas.",
  sub: "Each Maker quotes its own price; today that's 0.10–0.15% plus a few cents of withholding for destination gas. A mistyped code costs a small refund fee, never the transfer.",
  compare: "No bridge fee, no wrapped-token spread, no protocol take.",
};

export const faq = {
  eyebrow: "FAQ",
  heading: ["Questions,", "answered."],
  sub: "About codes, Makers, proofs and what you still trust.",
  items: [
    { q: "How do I choose where the money goes?", a: "You don't type a destination. The bridge computes the exact amount, and its last four digits name the chain: 9001 Monad, 9002 Sepolia, 9003 Base Sepolia, 9004 Arbitrum Sepolia, 9005 OP Sepolia." },
    { q: "What if I mistype the amount?", a: "If the last four digits aren't a route, the Maker must refund you on the source chain minus a small fee. That refund is enforced by the same proof and margin as a fill." },
    { q: "Why a zero-knowledge proof if Chainlink attests?", a: "Chainlink CRE commits data: one root per block window. The proof does the judging over it (your payment, the code, the fee math, the missing payout) at a fixed cost on Monad. The roots could later come from a light client without changing the circuit." },
    { q: "Who are the Makers?", a: "Anyone who posts margin on Monad, registers routes and fees in the EBC, and runs the open-source Maker node." },
    { q: "Which chains and assets?", a: "USDC between Monad testnet and Sepolia, Arbitrum Sepolia and OP Sepolia, both ways, and native ETH between Sepolia, Base Sepolia, Arbitrum Sepolia and OP Sepolia. A new chain is a config entry and a router." },
    { q: "What do I still trust?", a: "That each attested root is the true set of logs in its window, which today is Chainlink's DON. Everything else, from fee math to who gets slashed, is checked by the proof and the contracts." },
  ],
};

export const closing = {
  heading: "Bridge to Monad now.",
  sub: "USDC and ETH in about a second, from Makers whose margin you can see on every quote.",
};

export const chains = {
  eyebrow: "Chains",
  heading: ["Every route runs", "through Monad."],
  sub: "Monad is the hub: rules, Maker margin and disputes all live there. Each spoke only needs a router, so a new chain is a config entry, not a new bridge.",
};
