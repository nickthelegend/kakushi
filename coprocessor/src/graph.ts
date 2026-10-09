// The op-graph scheduler. Executor events arrive in (block, logIndex) order. Each op is submitted
// immediately as a promise that waits only for ITS operands, so independent ops (different users,
// different contracts in the same Monad block) run concurrently on the native engine, while every
// data dependency is respected. This mirrors Monad's optimistic parallel execution.
import type { Engine } from "./engine.ts";
import type { Metrics } from "./metrics.ts";

export type ExecEvent =
  | { kind: "op"; op: number; result: string; lhs: string; rhs: string; scalar: boolean }
  | { kind: "select"; result: string; control: string; ifTrue: string; ifFalse: string }
  | { kind: "trivial"; result: string; value: bigint; type: number }
  | { kind: "input"; result: string; inputHandle: string }
  | { kind: "rand"; result: string; seed: string; upperBound: bigint; type: number };

const NOT = 22;

class Limiter {
  private active = 0;
  private q: (() => void)[] = [];
  readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.q.shift()?.();
    }
  }
}

export class OpGraph {
  private ready = new Map<string, Promise<void>>();
  private limiter: Limiter;
  readonly engine: Engine;
  readonly metrics: Metrics;
  readonly log: (m: string) => void;

  constructor(engine: Engine, metrics: Metrics, concurrency = 4, log: (m: string) => void = () => {}) {
    this.engine = engine;
    this.metrics = metrics;
    this.limiter = new Limiter(concurrency);
    this.log = log;
  }

  /** Resolves when `handle`'s ciphertext exists in the engine. */
  async waitFor(handle: string, timeoutMs = 120_000): Promise<void> {
    const k = handle.toLowerCase();
    const p = this.ready.get(k);
    if (p) return p;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.engine.has(k)) return;
      const q = this.ready.get(k);
      if (q) return q;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`handle ${k} was never materialized`);
  }

  pending(): number {
    return this.ready.size;
  }

  submit(e: ExecEvent): void {
    const key = e.result.toLowerCase();
    if (this.ready.has(key)) return; // deterministic handles: already computed
    const deps =
      e.kind === "op" ? (e.scalar || e.op === NOT ? [e.lhs] : [e.lhs, e.rhs]) : e.kind === "select" ? [e.control, e.ifTrue, e.ifFalse] : [];
    const p = (async () => {
      await Promise.all(deps.map((d) => this.waitFor(d)));
      const t0 = Date.now();
      await this.limiter.run(async () => {
        switch (e.kind) {
          case "op":
            if (e.op === NOT) await this.engine.op(NOT, e.result, e.lhs, null, null);
            else if (e.scalar) await this.engine.op(e.op, e.result, e.lhs, null, BigInt(e.rhs).toString());
            else await this.engine.op(e.op, e.result, e.lhs, e.rhs, null);
            break;
          case "select":
            await this.engine.select(e.result, e.control, e.ifTrue, e.ifFalse);
            break;
          case "trivial":
            await this.engine.trivial(e.result, e.value, e.type);
            break;
          case "input":
            await this.waitFor(e.inputHandle, 30_000);
            await this.engine.alias(e.result, e.inputHandle);
            break;
          case "rand":
            await this.engine.rand(e.result, e.seed, e.upperBound, e.type);
            break;
        }
      });
      const ms = Date.now() - t0;
      this.metrics.add(e.kind === "op" ? `op.${e.op}` : e.kind, ms);
      this.metrics.inc("materialized");
    })();
    p.catch((err) => {
      this.metrics.inc("errors");
      this.log(`materialize ${key.slice(0, 10)} failed: ${(err as Error).message}`);
    });
    this.ready.set(key, p);
  }
}
