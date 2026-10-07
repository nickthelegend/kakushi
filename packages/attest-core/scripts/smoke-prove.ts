// Smoke test: build a source window and a payout window without the Maker's payout, prove
// PaymentCompliance, and print timing + public input count.
import { sourceLeaf, payoutLeaf, buildWindow, complianceInputs, net, splitCode, computeSrcRef, addr } from "../src/index.ts";
import { prove } from "../src/prover.ts";

const maker = "0x00000000000000000000000000000000000000aa";
const sender = "0x00000000000000000000000000000000000000bb";
const usdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const txHash = ("0x" + "11".repeat(32)) as `0x${string}`;
const gross = 100_009_001n;
const src = sourceLeaf({ chainId: 11155111, txHash, logIndex: 3, sender, maker, token: usdc, amount: gross, recipient: sender, blockNumber: 100n, timestamp: 1_000n });
const other = payoutLeaf({ chainId: 10143, srcRef: computeSrcRef(11155111, ("0x" + "22".repeat(32)) as `0x${string}`, 1), maker, recipient: sender, token: "0x534b2f3A21130d7a60830c2Df862319e593943A3", amount: 5n, kind: 2, blockNumber: 5n, timestamp: 1_005n });
const sw = buildWindow({ chainId: 11155111, kind: 1, fromBlock: 90n, toBlock: 110n, fromTime: 900n, toTime: 1100n, leaves: [src] });
const pw = buildWindow({ chainId: 10143, kind: 2, fromBlock: 1n, toBlock: 100n, fromTime: 980n, toTime: 1030n, leaves: [other] });
const { code, principal } = splitCode(gross);
const ctx = {
  domain: 12345n, srcChainId: 11155111n, obligationChainId: 10143n, srcRef: src.srcRef, maker: addr(maker), sender: addr(sender),
  recipient: addr(sender), srcToken: addr(usdc), payToken: addr("0x534b2f3A21130d7a60830c2Df862319e593943A3"), gross, identCode: BigInt(code),
  withholding: 50_000n, bps: 10n, expected: net(principal, 50_000n, 10n), mode: 1n, srcTimestamp: 1000n, deadline: 1020n,
};
const { inputs, publicInputs } = complianceInputs(ctx, sw.tree, src, [pw.tree]);
const r = await prove("payment_compliance", inputs, 8);
console.log(`proof bytes ${(r.proof.length - 2) / 2}, public inputs ${r.publicInputs.length}, ${r.ms} ms`);
const match = r.publicInputs.every((p, i) => BigInt(p) === publicInputs[i]);
console.log(`public inputs match witness builder: ${match}`);
