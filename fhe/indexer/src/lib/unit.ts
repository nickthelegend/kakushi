// Unit of work for one event: every aggregate a handler touches is loaded once, mutated in memory
// and written back once in flush(), so helpers never overwrite each other's copies.
import type { Account, DailyStats, GlobalStats, Payment, Token, TxScratch } from "envio";
import {
  type Ctx,
  type Mut,
  ZERO,
  dayIndex,
  insertSorted,
  lc,
  loadAccount,
  loadDaily,
  loadGlobal,
  loadToken,
  median,
  paymentId,
  txId,
} from "./common";

type Kind = Payment["kind"];
const KIND_FIELD: Record<Kind, "pays" | "payrollPayments" | "linkClaims" | "transfers"> = {
  PAY: "pays",
  PAYROLL: "payrollPayments",
  LINK_CLAIM: "linkClaims",
  TRANSFER: "transfers",
};

export class Unit {
  private g?: Mut<GlobalStats>;
  private days = new Map<string, Mut<DailyStats>>();
  private accounts = new Map<string, Mut<Account>>();
  private tokens = new Map<string, Mut<Token>>();
  private scratch?: Mut<TxScratch>;

  constructor(
    readonly ctx: Ctx,
    readonly chainId: number,
    readonly block: number,
    readonly ts: number,
    readonly tx: string,
  ) {}

  async global() {
    return (this.g ??= await loadGlobal(this.ctx, this.block, this.ts));
  }

  async day(ts = this.ts) {
    const id = `${this.chainId}-${dayIndex(ts)}`;
    let d = this.days.get(id);
    if (!d) {
      d = await loadDaily(this.ctx, this.chainId, ts);
      this.days.set(id, d);
    }
    return d;
  }

  async account(address: string) {
    const id = lc(address);
    let a = this.accounts.get(id);
    if (!a) {
      a = await loadAccount(this.ctx, await this.global(), id, this.block, this.ts);
      this.accounts.set(id, a);
    }
    return a;
  }

  async token(address: string) {
    const id = lc(address);
    let t = this.tokens.get(id);
    if (!t) {
      t = await loadToken(this.ctx, this.chainId, id);
      this.tokens.set(id, t);
    }
    return t;
  }

  /** Per-transaction scratch row (internal entity). */
  async txScratch() {
    if (!this.scratch) {
      const id = txId(this.chainId, this.tx);
      const cur = await this.ctx.TxScratch.get(id);
      this.scratch = cur ? { ...cur } : { id, releaseHandle: undefined, releaseTo: undefined, burnHandle: undefined, paidIds: [] };
    }
    return this.scratch;
  }

  /** A new confidential payment: counts it everywhere (payments, unique payers, edges). */
  async recordPayment(p: {
    token: string;
    kind: Kind;
    from: string;
    to: string;
    handle: string;
    ref?: string;
    payrollRunId?: string;
    linkId?: string;
    logIndex: number;
  }): Promise<Payment> {
    const g = await this.global();
    const d = await this.day();
    const token = await this.token(p.token);
    const from = await this.account(p.from);
    const to = await this.account(p.to);
    const payment: Payment = {
      id: paymentId(this.chainId, p.token, p.handle),
      chainId: this.chainId,
      token_id: token.id,
      kind: p.kind,
      from_id: from.id,
      to_id: to.id,
      amountHandle: lc(p.handle),
      ref: p.ref,
      payrollRun_id: p.payrollRunId,
      link_id: p.linkId,
      request_id: undefined,
      blockNumber: this.block,
      timestamp: this.ts,
      txHash: lc(this.tx),
      logIndex: p.logIndex,
    };
    this.ctx.Payment.set(payment);

    const f = KIND_FIELD[p.kind];
    g.payments += 1;
    g[f] += 1;
    d.payments += 1;
    d[f] += 1;
    token.payments += 1;

    if (from.paymentsSent === 0) g.uniquePayers += 1;
    from.paymentsSent += 1;
    to.paymentsReceived += 1;
    if (p.kind === "PAYROLL") to.payrollPaymentsReceived += 1;

    const dayMark = `${this.chainId}-${dayIndex(this.ts)}-${from.id}`;
    if (!(await this.ctx.PayerDay.get(dayMark))) {
      this.ctx.PayerDay.set({ id: dayMark });
      d.uniquePayers += 1;
    }

    const edgeId = `${this.chainId}-${from.id}-${to.id}`;
    const edge = await this.ctx.PayPair.get(edgeId);
    if (!edge) from.counterparties += 1;
    this.ctx.PayPair.set({
      id: edgeId,
      from_id: from.id,
      to_id: to.id,
      count: (edge?.count ?? 0) + 1,
      firstAt: edge?.firstAt ?? this.ts,
      lastAt: this.ts,
    });
    return payment;
  }

  /** A payment turned out to be more specific (TRANSFER -> PAY -> PAYROLL): move its count. */
  async reclassify(p: Payment, kind: Kind, patch: Partial<Pick<Payment, "ref" | "payrollRun_id" | "link_id">> = {}) {
    if (p.kind !== kind) {
      const g = await this.global();
      const d = await this.day(p.timestamp);
      g[KIND_FIELD[p.kind]] -= 1;
      g[KIND_FIELD[kind]] += 1;
      d[KIND_FIELD[p.kind]] -= 1;
      d[KIND_FIELD[kind]] += 1;
      if (kind === "PAYROLL") (await this.account(p.to_id)).payrollPaymentsReceived += 1;
    }
    const next: Payment = { ...p, ...patch, kind };
    this.ctx.Payment.set(next);
    return next;
  }

  /** Record a link claim duration and refresh avg/median. */
  async addClaimSample(seconds: number) {
    const g = await this.global();
    const id = "global";
    const cur = await this.ctx.ClaimSamples.get(id);
    const samples = insertSorted(cur?.samples ?? [], seconds);
    this.ctx.ClaimSamples.set({ id, samples });
    g.linkClaimSecondsTotal += seconds;
    g.linkClaimAvgSeconds = g.linkClaimSecondsTotal / samples.length;
    g.linkClaimMedianSeconds = median(samples);
  }

  flush() {
    if (this.g) {
      this.g.publicTvl = this.g.publicWrapped - this.g.publicUnwrapped;
      this.ctx.GlobalStats.set(this.g);
    }
    for (const d of this.days.values()) this.ctx.DailyStats.set(d);
    for (const a of this.accounts.values()) if (a.id !== ZERO) this.ctx.Account.set(a);
    for (const t of this.tokens.values()) {
      t.publicTvl = t.publicWrapped - t.publicUnwrapped;
      this.ctx.Token.set(t);
    }
    if (this.scratch) this.ctx.TxScratch.set(this.scratch);
  }
}
