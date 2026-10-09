// Fhish Pay token events: wrap / unwrap (public amounts), confidential payments, pay links, payroll.
// Amounts of payments are euint64 ciphertext handles; they are stored as handles, never as numbers.
import { indexer, type PayLink, type PayrollRun, type Unwrap } from "envio";
import { ZERO, lc, linkId, paymentId, revealId, unwrapId } from "../lib/common";
import { Unit } from "../lib/unit";

const TX = { transaction: ["hash"], block: ["timestamp"] } as const;

// ConfidentialTransfer is emitted by every balance move. Mints (wrap), burns (unwrap), escrow into
// and out of the token (pay links) are explained by the event that follows in the same tx; anything
// else is a plain confidentialTransfer, upgraded to PAY / PAYROLL if a Paid event follows.
indexer.onEvent({ contract: "FhishPayToken", event: "ConfidentialTransfer", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const token = lc(event.srcAddress);
  const from = lc(event.params.from);
  const to = lc(event.params.to);
  if (from === ZERO) return; // mint: Wrapped carries the public amount
  if (to === ZERO) {
    (await u.txScratch()).burnHandle = lc(event.params.amount); // unwrap burn
  } else if (to === token) {
    return; // escrow into a pay link: LinkCreated carries the handle
  } else if (from === token) {
    const s = await u.txScratch(); // escrow release: LinkClaimed / LinkRefunded follows
    s.releaseHandle = lc(event.params.amount);
    s.releaseTo = to;
  } else {
    await u.recordPayment({ token, kind: "TRANSFER", from, to, handle: event.params.amount, logIndex: event.logIndex });
  }
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "Paid", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const token = lc(event.srcAddress);
  const id = paymentId(event.chainId, token, event.params.amount);
  const existing = await context.Payment.get(id);
  if (existing) await u.reclassify(existing, existing.kind === "TRANSFER" ? "PAY" : existing.kind, { ref: lc(event.params.ref) });
  else
    await u.recordPayment({ token, kind: "PAY", from: event.params.from, to: event.params.to, handle: event.params.amount, ref: lc(event.params.ref), logIndex: event.logIndex });
  const s = await u.txScratch();
  s.paidIds = [...s.paidIds, id];
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "PayrollRun", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const token = lc(event.srcAddress);
  const employer = lc(event.params.employer);
  const operator = lc(event.params.operator);
  const ref = lc(event.params.ref);
  const viaOperator = employer !== operator;
  const runId = `${event.chainId}-${lc(event.transaction.hash)}-${event.logIndex}`;
  const run: PayrollRun = {
    id: runId,
    chainId: event.chainId,
    token_id: (await u.token(token)).id,
    employer_id: employer,
    operator_id: operator,
    viaOperator,
    count: Number(event.params.count),
    ref,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: lc(event.transaction.hash),
  };
  context.PayrollRun.set(run);

  const g = await u.global();
  g.payrollRuns += 1;
  if (viaOperator) g.payrollRunsViaOperator += 1;
  (await u.day()).payrollRuns += 1;
  (await u.account(employer)).payrollsRun += 1;
  if (viaOperator) (await u.account(operator)).payrollsOperated += 1;

  // the salaries were emitted as Paid events just before, in this same tx
  const s = await u.txScratch();
  const rest: string[] = [];
  for (const pid of s.paidIds) {
    const p = await context.Payment.get(pid);
    if (p && p.from_id === employer && p.ref === ref && p.kind === "PAY") await u.reclassify(p, "PAYROLL", { payrollRun_id: runId });
    else rest.push(pid);
  }
  s.paidIds = rest;
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "LinkCreated", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const token = lc(event.srcAddress);
  const sender = await u.account(event.params.sender);
  const link: PayLink = {
    id: linkId(event.chainId, token, event.params.id),
    chainId: event.chainId,
    token_id: (await u.token(token)).id,
    linkId: event.params.id,
    sender_id: sender.id,
    claimKey: lc(event.params.claimKey),
    expiry: Number(event.params.expiry),
    amountHandle: lc(event.params.amount),
    state: "OPEN",
    createdBlock: event.block.number,
    createdAt: event.block.timestamp,
    createdTx: lc(event.transaction.hash),
    claimedBy_id: undefined,
    claimedBlock: undefined,
    claimedAt: undefined,
    claimSeconds: undefined,
    claimBlocks: undefined,
    claimPayment_id: undefined,
    refundedAt: undefined,
    refundedBlock: undefined,
  };
  context.PayLink.set(link);
  sender.linksCreated += 1;
  const g = await u.global();
  g.linksCreated += 1;
  g.linksOpen += 1;
  (await u.day()).linksCreated += 1;
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "LinkClaimed", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const token = lc(event.srcAddress);
  const link = await context.PayLink.get(linkId(event.chainId, token, event.params.id));
  if (!link) {
    context.log.warn(`LinkClaimed for unknown link ${event.params.id} (indexer started after it was created)`);
    return;
  }
  const s = await u.txScratch();
  const handle = s.releaseHandle ?? link.amountHandle;
  s.releaseHandle = undefined;
  s.releaseTo = undefined;
  const claimer = lc(event.params.to);
  const payment = await u.recordPayment({ token, kind: "LINK_CLAIM", from: link.sender_id, to: claimer, handle, linkId: link.id, logIndex: event.logIndex });
  const claimSeconds = event.block.timestamp - link.createdAt;
  context.PayLink.set({
    ...link,
    state: "CLAIMED",
    claimedBy_id: claimer,
    claimedBlock: event.block.number,
    claimedAt: event.block.timestamp,
    claimSeconds,
    claimBlocks: event.block.number - link.createdBlock,
    claimPayment_id: payment.id,
  });
  (await u.account(claimer)).linksClaimed += 1;
  const g = await u.global();
  g.linksClaimed += 1;
  g.linksOpen -= 1;
  (await u.day()).linksClaimed += 1;
  await u.addClaimSample(claimSeconds);
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "LinkRefunded", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const link = await context.PayLink.get(linkId(event.chainId, event.srcAddress, event.params.id));
  if (!link) return;
  context.PayLink.set({ ...link, state: "REFUNDED", refundedAt: event.block.timestamp, refundedBlock: event.block.number });
  (await u.account(link.sender_id)).linksRefunded += 1;
  const g = await u.global();
  g.linksRefunded += 1;
  g.linksOpen -= 1;
  (await u.day()).linksRefunded += 1;
  const s = await u.txScratch();
  s.releaseHandle = undefined;
  s.releaseTo = undefined;
  u.flush();
});

// ------------------------------------------------------------------ public on-/off-ramp (TVL)

indexer.onEvent({ contract: "FhishPayToken", event: "Wrapped", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const amount = event.params.amount;
  const t = await u.token(event.srcAddress);
  t.wraps += 1;
  t.publicWrapped += amount;
  const a = await u.account(event.params.account);
  a.wraps += 1;
  a.publicWrapped += amount;
  const g = await u.global();
  g.wraps += 1;
  g.publicWrapped += amount;
  const d = await u.day();
  d.wraps += 1;
  d.publicWrapped += amount;
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "UnwrapRequested", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const t = await u.token(event.srcAddress);
  t.unwrapsRequested += 1;
  const a = await u.account(event.params.account);
  a.unwrapsRequested += 1;
  (await u.global()).unwrapsRequested += 1;
  const s = await u.txScratch();
  const unwrap: Unwrap = {
    id: unwrapId(event.chainId, event.srcAddress, event.params.requestId),
    chainId: event.chainId,
    token_id: t.id,
    account_id: a.id,
    requestId: event.params.requestId,
    reveal_id: revealId(event.chainId, event.params.requestId),
    burnedHandle: s.burnHandle,
    requestedBlock: event.block.number,
    requestedAt: event.block.timestamp,
    requestTx: lc(event.transaction.hash),
    settled: false,
    amount: undefined,
    settledBlock: undefined,
    settledAt: undefined,
    settleSeconds: undefined,
  };
  context.Unwrap.set(unwrap);
  s.burnHandle = undefined;
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "Unwrapped", fields: TX }, async ({ event, context }) => {
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, event.transaction.hash);
  const amount = event.params.amount; // public by design: it leaves the confidential pool
  const t = await u.token(event.srcAddress);
  t.unwrapsSettled += 1;
  t.publicUnwrapped += amount;
  const a = await u.account(event.params.account);
  a.publicUnwrapped += amount;
  const g = await u.global();
  g.unwrapsSettled += 1;
  g.publicUnwrapped += amount;
  (await u.day()).publicUnwrapped += amount;
  const uw = await context.Unwrap.get(unwrapId(event.chainId, event.srcAddress, event.params.requestId));
  if (uw)
    context.Unwrap.set({
      ...uw,
      settled: true,
      amount,
      settledBlock: event.block.number,
      settledAt: event.block.timestamp,
      settleSeconds: event.block.timestamp - uw.requestedAt,
    });
  u.flush();
});

indexer.onEvent({ contract: "FhishPayToken", event: "OperatorSet", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const holder = lc(event.params.holder);
  const operator = lc(event.params.operator);
  const u = new Unit(context, event.chainId, event.block.number, event.block.timestamp, "0x");
  await u.account(holder);
  await u.account(operator);
  const t = await u.token(event.srcAddress);
  context.OperatorGrant.set({
    id: `${t.id}-${holder}-${operator}`,
    token_id: t.id,
    holder_id: holder,
    operator_id: operator,
    until: Number(event.params.until),
    updatedAt: event.block.timestamp,
  });
  u.flush();
});
