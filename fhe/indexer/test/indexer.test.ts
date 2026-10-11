// Handler tests on Envio's in-process test indexer (simulated events, in-memory store).
import { describe, it } from "vitest";
import { createTestIndexer } from "envio";
import { CRE_FORWARDER, TOKENS } from "../src/network.generated";

type Addr = `0x${string}`;
const CHAIN = 10143 as const;
const [CAUSD, CUSDC] = Object.keys(TOKENS) as [`0x${string}`, `0x${string}`];
const ZERO: Addr = "0x0000000000000000000000000000000000000000";
const ALICE: Addr = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const BOB: Addr = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const CAROL: Addr = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const OPERATOR: Addr = "0x14dc79964da2c08b23698b3d3cc7ca32193d9955";
const NEWCOMER: Addr = "0x1111111111111111111111111111111111111111";
const RELAYER: Addr = "0x2222222222222222222222222222222222222222";
const ORACLE: Addr = "0x6a70da54762ff8637b00bbe35d2fe396fbf1cf97";

const h = (n: number) => `0x${n.toString(16).padStart(62, "0")}05` as const; // euint64-typed handle
const tx = (n: number) => `0x${n.toString(16).padStart(64, "a")}` as const;
const ref = (s: string) => `0x${Buffer.from(s).toString("hex").padEnd(64, "0")}` as const;
const B0 = 69_600_000; // above the configured start block
const T0 = 1_791_500_000;
const at = (dBlock: number, dSec: number, txN: number) => ({
  block: { number: B0 + dBlock, timestamp: T0 + dSec },
  // handler-level `fields` select the hash; the simulate type only knows config-level field_selection
  transaction: { hash: tx(txN) } as never,
});

describe("payments", () => {
  it("counts transfers, payments and payroll salaries once each, never with an amount", async (t) => {
    const ix = createTestIndexer();
    const R = ref("2026-10 payroll");
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            // pay(): ConfidentialTransfer then Paid in the same tx
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(1, 1, 1), params: { from: ALICE, to: BOB, amount: h(1) } },
            { contract: "KakushiPayToken", event: "Paid", ...at(1, 1, 1), params: { from: ALICE, to: BOB, amount: h(1), ref: ref("invoice-42") } },
            // plain confidentialTransfer
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(2, 2, 2), params: { from: BOB, to: CAROL, amount: h(2) } },
            // runPayrollFrom by an operator: two salaries
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(3, 3, 3), params: { from: ALICE, to: BOB, amount: h(3) } },
            { contract: "KakushiPayToken", event: "Paid", ...at(3, 3, 3), params: { from: ALICE, to: BOB, amount: h(3), ref: R } },
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(3, 3, 3), params: { from: ALICE, to: CAROL, amount: h(4) } },
            { contract: "KakushiPayToken", event: "Paid", ...at(3, 3, 3), params: { from: ALICE, to: CAROL, amount: h(4), ref: R } },
            { contract: "KakushiPayToken", event: "PayrollRun", ...at(3, 3, 3), params: { employer: ALICE, operator: OPERATOR, count: 2n, ref: R } },
          ],
        },
      },
    });

    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({ payments: g.payments, pays: g.pays, transfers: g.transfers, payroll: g.payrollPayments, runs: g.payrollRuns, viaOp: g.payrollRunsViaOperator, payers: g.uniquePayers }).toEqual({
      payments: 4,
      pays: 1,
      transfers: 1,
      payroll: 2,
      runs: 1,
      viaOp: 1,
      payers: 2,
    });

    const pay = await ix.Payment.getOrThrow(`${CHAIN}-${CAUSD}-${h(1)}`);
    t.expect({ kind: pay.kind, ref: pay.ref, handle: pay.amountHandle, from: pay.from_id, to: pay.to_id }).toEqual({ kind: "PAY", ref: ref("invoice-42"), handle: h(1), from: ALICE, to: BOB });
    t.expect((await ix.Payment.getOrThrow(`${CHAIN}-${CAUSD}-${h(2)}`)).kind).toBe("TRANSFER");
    const salary = await ix.Payment.getOrThrow(`${CHAIN}-${CAUSD}-${h(3)}`);
    t.expect(salary.kind).toBe("PAYROLL");
    const [run] = await ix.PayrollRun.getAll();
    t.expect({ id: salary.payrollRun_id, count: run!.count, viaOperator: run!.viaOperator, employer: run!.employer_id }).toEqual({ id: run!.id, count: 2, viaOperator: true, employer: ALICE });

    const alice = await ix.Account.getOrThrow(ALICE);
    const bob = await ix.Account.getOrThrow(BOB);
    const op = await ix.Account.getOrThrow(OPERATOR);
    t.expect({ sent: alice.paymentsSent, cps: alice.counterparties, runs: alice.payrollsRun }).toEqual({ sent: 3, cps: 2, runs: 1 });
    t.expect({ recv: bob.paymentsReceived, payroll: bob.payrollPaymentsReceived, sent: bob.paymentsSent }).toEqual({ recv: 2, payroll: 1, sent: 1 });
    t.expect(op.payrollsOperated).toBe(1);
    t.expect((await ix.PayPair.getOrThrow(`${CHAIN}-${ALICE}-${BOB}`)).count).toBe(2);

    const day = (await ix.DailyStats.getAll())[0]!;
    t.expect({ payments: day.payments, payroll: day.payrollPayments, payers: day.uniquePayers, runs: day.payrollRuns }).toEqual({ payments: 4, payroll: 2, payers: 2, runs: 1 });

    const token = await ix.Token.getOrThrow(`${CHAIN}-${CAUSD}`);
    t.expect(token.payments).toBe(4);
    // the schema has no numeric amount on a payment: only the ciphertext handle
    t.expect(Object.keys(pay).filter((k) => /amount/i.test(k))).toEqual(["amountHandle"]);
  });
});

describe("pay links", () => {
  it("walks OPEN -> CLAIMED / REFUNDED and tracks claim latency (avg + median)", async (t) => {
    const ix = createTestIndexer();
    const key: Addr = "0x9999999999999999999999999999999999999999";
    const created = (id: bigint, d: number, txN: number, amt: number) => [
      { contract: "KakushiPayToken" as const, event: "ConfidentialTransfer" as const, ...at(d, d, txN), params: { from: ALICE, to: CAUSD, amount: h(amt) } },
      { contract: "KakushiPayToken" as const, event: "LinkCreated" as const, ...at(d, d, txN), params: { id, sender: ALICE, claimKey: key, expiry: BigInt(T0 + 86_400), amount: h(amt) } },
    ];
    const claimed = (id: bigint, d: number, dSec: number, txN: number, amt: number, to: `0x${string}` = NEWCOMER) => [
      { contract: "KakushiPayToken" as const, event: "ConfidentialTransfer" as const, ...at(d, dSec, txN), params: { from: CAUSD, to, amount: h(amt) } },
      { contract: "KakushiPayToken" as const, event: "LinkClaimed" as const, ...at(d, dSec, txN), params: { id, to } },
    ];
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            ...created(1n, 1, 10, 100), // link 1 at T0+1
            ...created(2n, 2, 11, 200), // link 2 at T0+2
            ...created(3n, 3, 12, 300), // link 3 at T0+3
            ...created(4n, 4, 13, 400), // link 4, will be refunded
            ...claimed(1n, 10, 91, 14, 101), // 90 s
            ...claimed(2n, 11, 32, 15, 201, BOB), // 30 s
            ...claimed(3n, 12, 303, 16, 301), // 300 s
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(13, 90_000, 17), params: { from: CAUSD, to: ALICE, amount: h(401) } },
            { contract: "KakushiPayToken", event: "LinkRefunded", ...at(13, 90_000, 17), params: { id: 4n } },
          ],
        },
      },
    });

    const l1 = await ix.PayLink.getOrThrow(`${CHAIN}-${CAUSD}-1`);
    t.expect({ state: l1.state, by: l1.claimedBy_id, secs: l1.claimSeconds, blocks: l1.claimBlocks, handle: l1.amountHandle }).toEqual({
      state: "CLAIMED",
      by: NEWCOMER,
      secs: 90,
      blocks: 9,
      handle: h(100),
    });
    t.expect((await ix.PayLink.getOrThrow(`${CHAIN}-${CAUSD}-4`)).state).toBe("REFUNDED");

    // the claim is a LINK_CLAIM payment from the link's sender, carrying the released handle
    const p = await ix.Payment.getOrThrow(l1.claimPayment_id!);
    t.expect({ kind: p.kind, from: p.from_id, to: p.to_id, handle: p.amountHandle, link: p.link_id }).toEqual({ kind: "LINK_CLAIM", from: ALICE, to: NEWCOMER, handle: h(101), link: l1.id });

    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({
      created: g.linksCreated,
      claimed: g.linksClaimed,
      refunded: g.linksRefunded,
      open: g.linksOpen,
      avg: g.linkClaimAvgSeconds,
      median: g.linkClaimMedianSeconds,
      linkClaims: g.linkClaims,
      payments: g.payments,
    }).toEqual({ created: 4, claimed: 3, refunded: 1, open: 0, avg: 140, median: 90, linkClaims: 3, payments: 3 });
    const alice = await ix.Account.getOrThrow(ALICE);
    t.expect({ created: alice.linksCreated, refunded: alice.linksRefunded, sent: alice.paymentsSent }).toEqual({ created: 4, refunded: 1, sent: 3 });
    t.expect((await ix.Account.getOrThrow(NEWCOMER)).linksClaimed).toBe(2);
    // escrow moves into/out of the token contract are not payments, and the token is not an account
    t.expect(await ix.Account.get(CAUSD)).toBeUndefined();
  });
});

describe("reveals", () => {
  it("measures request -> callback latency per delivery path and never stores cleartexts", async (t) => {
    const ix = createTestIndexer();
    const CLEAR = 987_654_321n;
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "KakushiDecryptionOracle", event: "DecryptionRequested", srcAddress: ORACLE, ...at(1, 10, 1), params: { requestId: 1n, requester: CAUSD, handles: [h(9)], callback: "0x12345678" } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionRequested", srcAddress: ORACLE, ...at(2, 11, 2), params: { requestId: 2n, requester: BOB, handles: [h(10), h(11)], callback: "0xabcdef01" } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionRequested", srcAddress: ORACLE, ...at(3, 12, 3), params: { requestId: 3n, requester: BOB, handles: [h(12)], callback: "0xabcdef01" } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionFulfilled", srcAddress: ORACLE, ...at(4, 14, 4), params: { requestId: 1n, cleartexts: [CLEAR], callbackOk: true, via: RELAYER } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionFulfilled", srcAddress: ORACLE, ...at(8, 19, 5), params: { requestId: 2n, cleartexts: [CLEAR, CLEAR], callbackOk: false, via: CRE_FORWARDER as `0x${string}` } },
          ],
        },
      },
    });
    const r1 = await ix.Reveal.getOrThrow(`${CHAIN}-1`);
    t.expect({ status: r1.status, lb: r1.latencyBlocks, ls: r1.latencySeconds, path: r1.path, app: r1.app, n: r1.handlesCount, ok: r1.callbackOk }).toEqual({
      status: "FULFILLED",
      lb: 3,
      ls: 4,
      path: "RELAYER",
      app: "cAUSD",
      n: 1,
      ok: true,
    });
    const r2 = await ix.Reveal.getOrThrow(`${CHAIN}-2`);
    t.expect({ lb: r2.latencyBlocks, ls: r2.latencySeconds, path: r2.path, app: r2.app, n: r2.handlesCount }).toEqual({ lb: 6, ls: 8, path: "CRE", app: "app", n: 2 });
    t.expect((await ix.Reveal.getOrThrow(`${CHAIN}-3`)).status).toBe("PENDING");

    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({
      reveals: g.reveals,
      fulfilled: g.revealsFulfilled,
      pending: g.revealsPending,
      cre: g.revealsViaCre,
      relayer: g.revealsViaRelayer,
      failed: g.revealCallbacksFailed,
      avgS: g.revealAvgLatencySeconds,
      avgB: g.revealAvgLatencyBlocks,
    }).toEqual({ reveals: 3, fulfilled: 2, pending: 1, cre: 1, relayer: 1, failed: 1, avgS: 6, avgB: 4.5 });

    const everything = JSON.stringify(
      [await ix.Reveal.getAll(), await ix.GlobalStats.getAll(), await ix.DailyStats.getAll()],
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    t.expect(everything.includes(CLEAR.toString())).toBe(false);
  });
});

describe("public TVL", () => {
  it("is wrapped - unwrapped, per token and globally, with the unwrap settled through its reveal", async (t) => {
    const ix = createTestIndexer();
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(1, 1, 1), params: { from: ZERO, to: ALICE, amount: h(50) } },
            { contract: "KakushiPayToken", event: "Wrapped", ...at(1, 1, 1), params: { account: ALICE, amount: 5_000_000_000n } },
            { contract: "KakushiPayToken", event: "Wrapped", ...at(2, 2, 2), params: { account: BOB, amount: 300_000_000n } },
            { contract: "KakushiPayToken", event: "Wrapped", srcAddress: CUSDC, ...at(3, 3, 3), params: { account: CAROL, amount: 200_000_000n } },
            // unwrap: burn, oracle request, UnwrapRequested (one tx) ... then the KMS callback
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(4, 4, 4), params: { from: BOB, to: ZERO, amount: h(77) } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionRequested", srcAddress: ORACLE, ...at(4, 4, 4), params: { requestId: 7n, requester: CAUSD, handles: [h(77)], callback: "0x11111111" } },
            { contract: "KakushiPayToken", event: "UnwrapRequested", ...at(4, 4, 4), params: { requestId: 7n, account: BOB } },
            { contract: "KakushiPayToken", event: "Unwrapped", ...at(6, 7, 5), params: { requestId: 7n, account: BOB, amount: 100_000_000n } },
            { contract: "KakushiDecryptionOracle", event: "DecryptionFulfilled", srcAddress: ORACLE, ...at(6, 7, 5), params: { requestId: 7n, cleartexts: [100_000_000n], callbackOk: true, via: RELAYER } },
          ],
        },
      },
    });
    const causd = await ix.Token.getOrThrow(`${CHAIN}-${CAUSD}`);
    const cusdc = await ix.Token.getOrThrow(`${CHAIN}-${CUSDC}`);
    t.expect({ w: causd.publicWrapped, u: causd.publicUnwrapped, tvl: causd.publicTvl, wraps: causd.wraps, settled: causd.unwrapsSettled, sym: causd.symbol }).toEqual({
      w: 5_300_000_000n,
      u: 100_000_000n,
      tvl: 5_200_000_000n,
      wraps: 2,
      settled: 1,
      sym: "cAUSD",
    });
    t.expect(cusdc.publicTvl).toBe(200_000_000n);
    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({ w: g.publicWrapped, u: g.publicUnwrapped, tvl: g.publicTvl, wraps: g.wraps, payments: g.payments }).toEqual({
      w: 5_500_000_000n,
      u: 100_000_000n,
      tvl: 5_400_000_000n,
      wraps: 3,
      payments: 0, // mints and burns are not payments
    });
    const uw = await ix.Unwrap.getOrThrow(`${CHAIN}-${CAUSD}-7`);
    t.expect({ settled: uw.settled, amount: uw.amount, burned: uw.burnedHandle, secs: uw.settleSeconds, reveal: uw.reveal_id }).toEqual({
      settled: true,
      amount: 100_000_000n,
      burned: h(77),
      secs: 3,
      reveal: `${CHAIN}-7`,
    });
    const bob = await ix.Account.getOrThrow(BOB);
    t.expect({ w: bob.publicWrapped, u: bob.publicUnwrapped, n: bob.unwrapsRequested }).toEqual({ w: 300_000_000n, u: 100_000_000n, n: 1 });
  });
});

describe("FHE executor", () => {
  it("aggregates ops per opcode and per calling app", async (t) => {
    const ix = createTestIndexer();
    const EXECUTOR = "0x4488f514d57837771d4b700ab22d4c58cd66cd53";
    const op = (code: bigint, scalar: boolean, caller: `0x${string}`, d: number) => ({
      contract: "KakushiExecutor" as const,
      event: "FheOp" as const,
      srcAddress: EXECUTOR as `0x${string}`,
      block: { number: B0 + d, timestamp: T0 + d },
      params: { op: code, result: h(d), lhs: h(d + 1), rhs: h(d + 2), scalar, caller },
    });
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            op(15n, false, CAUSD, 1),
            op(1n, false, CAUSD, 1),
            op(2n, false, CAUSD, 1),
            op(1n, true, BOB, 2),
            { contract: "KakushiExecutor", event: "FheSelect", srcAddress: EXECUTOR, block: { number: B0 + 3, timestamp: T0 + 3 }, params: { result: h(5), control: h(6), ifTrue: h(7), ifFalse: h(8), caller: CAUSD } },
            { contract: "KakushiExecutor", event: "VerifyInput", srcAddress: EXECUTOR, block: { number: B0 + 3, timestamp: T0 + 3 }, params: { result: h(9), inputHandle: h(10), user: ALICE, caller: CAUSD } },
            { contract: "KakushiExecutor", event: "TrivialEncrypt", srcAddress: EXECUTOR, block: { number: B0 + 4, timestamp: T0 + 4 }, params: { result: h(11), value: 0n, toType: 5n } },
          ],
        },
      },
    });
    const add = await ix.FheOpStat.getOrThrow(`${CHAIN}-add`);
    t.expect({ n: add.count, scalar: add.scalarCount, opcode: add.opcode }).toEqual({ n: 2, scalar: 1, opcode: 1 });
    const caller = await ix.FheCallerStat.getOrThrow(`${CHAIN}-${CAUSD}`);
    t.expect({ ops: caller.ops, selects: caller.selects, inputs: caller.inputsVerified, label: caller.label }).toEqual({ ops: 3, selects: 1, inputs: 1, label: "cAUSD" });
    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({ ops: g.fheOps, sel: g.fheSelects, inputs: g.fheInputsVerified, trivial: g.fheTrivialEncrypts }).toEqual({ ops: 7, sel: 1, inputs: 1, trivial: 1 });
  });
});

describe("payment requests", () => {
  it("tracks requests, pay attempts and cancellations without ever an amount or a settled flag", async (t) => {
    const ix = createTestIndexer();
    const exp = BigInt(T0 + 86_400);
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            // carol asks bob (#1) and the newcomer (#2); alice asks bob (#3)
            { contract: "KakushiPayToken", event: "PaymentRequested", ...at(1, 1, 30), params: { id: 1n, payee: CAROL, payer: BOB, expiry: exp, ref: ref("rent october"), due: h(500) } },
            { contract: "KakushiPayToken", event: "PaymentRequested", ...at(2, 2, 31), params: { id: 2n, payee: CAROL, payer: NEWCOMER, expiry: exp, ref: ref("too much"), due: h(501) } },
            { contract: "KakushiPayToken", event: "PaymentRequested", ...at(3, 3, 32), params: { id: 3n, payee: ALICE, payer: BOB, expiry: exp, ref: ref("lunch"), due: h(502) } },
            // bob pays #1: the value move is a ConfidentialTransfer in the same tx
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(4, 10, 33), params: { from: BOB, to: CAROL, amount: h(503) } },
            { contract: "KakushiPayToken", event: "RequestPaid", ...at(4, 10, 33), params: { id: 1n, payer: BOB, sent: h(503) } },
            // the newcomer tries #2 twice (balance short: an encrypted 0 moves each time)
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(5, 20, 34), params: { from: NEWCOMER, to: CAROL, amount: h(504) } },
            { contract: "KakushiPayToken", event: "RequestPaid", ...at(5, 20, 34), params: { id: 2n, payer: NEWCOMER, sent: h(504) } },
            { contract: "KakushiPayToken", event: "ConfidentialTransfer", ...at(6, 30, 35), params: { from: NEWCOMER, to: CAROL, amount: h(505) } },
            { contract: "KakushiPayToken", event: "RequestPaid", ...at(6, 30, 35), params: { id: 2n, payer: NEWCOMER, sent: h(505) } },
            // alice cancels #3
            { contract: "KakushiPayToken", event: "RequestCancelled", ...at(7, 40, 36), params: { id: 3n } },
          ],
        },
      },
    });

    const r1 = await ix.PayRequest.getOrThrow(`${CHAIN}-${CAUSD}-1`);
    t.expect({ payee: r1.payee_id, payer: r1.payer_id, ref: r1.ref, due: r1.dueHandle, attempts: r1.payAttempts, lastPaidAt: r1.lastPaidAt, lastPaidBlock: r1.lastPaidBlock, cancelled: r1.cancelled, expiry: r1.expiry, createdAt: r1.createdAt }).toEqual({
      payee: CAROL,
      payer: BOB,
      ref: ref("rent october"),
      due: h(500),
      attempts: 1,
      lastPaidAt: T0 + 10,
      lastPaidBlock: B0 + 4,
      cancelled: false,
      expiry: T0 + 86_400,
      createdAt: T0 + 1,
    });
    const r2 = await ix.PayRequest.getOrThrow(`${CHAIN}-${CAUSD}-2`);
    t.expect({ attempts: r2.payAttempts, lastPaidAt: r2.lastPaidAt, cancelled: r2.cancelled }).toEqual({ attempts: 2, lastPaidAt: T0 + 30, cancelled: false });
    const r3 = await ix.PayRequest.getOrThrow(`${CHAIN}-${CAUSD}-3`);
    t.expect({ attempts: r3.payAttempts, cancelled: r3.cancelled, cancelledAt: r3.cancelledAt }).toEqual({ attempts: 0, cancelled: true, cancelledAt: T0 + 40 });
    // nothing numeric about the amount, and no "paid" flag: settlement is encrypted
    t.expect(Object.keys(r1).filter((k) => /amount|paid$|settled|status/i.test(k))).toEqual([]);

    const g = await ix.GlobalStats.getOrThrow("global");
    t.expect({ requests: g.requests, attempts: g.requestPayAttempts, cancelled: g.requestsCancelled, transfers: g.transfers }).toEqual({ requests: 3, attempts: 3, cancelled: 1, transfers: 3 });
    const day = (await ix.DailyStats.getAll())[0]!;
    t.expect({ requests: day.requests, attempts: day.requestPayAttempts, cancelled: day.requestsCancelled }).toEqual({ requests: 3, attempts: 3, cancelled: 1 });

    const carol = await ix.Account.getOrThrow(CAROL);
    const bob = await ix.Account.getOrThrow(BOB);
    const alice = await ix.Account.getOrThrow(ALICE);
    const nc = await ix.Account.getOrThrow(NEWCOMER);
    t.expect({ carolSent: carol.requestsSent, carolRecv: carol.requestsReceived, bobRecv: bob.requestsReceived, bobSent: bob.requestsSent, aliceSent: alice.requestsSent, ncRecv: nc.requestsReceived }).toEqual({
      carolSent: 2,
      carolRecv: 0,
      bobRecv: 2,
      bobSent: 0,
      aliceSent: 1,
      ncRecv: 1,
    });
    t.expect(alice.lastSeenAt).toBe(T0 + 40); // the cancel touches the payee
  });

  it("ignores pays and cancels for requests created before the start block", async (t) => {
    const ix = createTestIndexer();
    await ix.process({
      chains: {
        [CHAIN]: {
          simulate: [
            { contract: "KakushiPayToken", event: "RequestPaid", ...at(1, 1, 40), params: { id: 99n, payer: BOB, sent: h(600) } },
            { contract: "KakushiPayToken", event: "RequestCancelled", ...at(2, 2, 41), params: { id: 98n } },
          ],
        },
      },
    });
    t.expect(await ix.PayRequest.getAll()).toEqual([]);
    const g = await ix.GlobalStats.getOrThrow("global");
    // the raw event counts still match the chain (verify.ts recomputes them from eth_getLogs)
    t.expect({ attempts: g.requestPayAttempts, cancelled: g.requestsCancelled, requests: g.requests }).toEqual({ attempts: 1, cancelled: 1, requests: 0 });
  });
});
